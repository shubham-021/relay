/**
 * lib/media-migration.ts
 * Composite-PK migration for the media table (LIB_FIX_PLAN.md Phase 1).
 *
 * tmdb_id alone is NOT unique across TMDB categories — movie/1398 = Stalker (1979),
 * tv/1398 = The Sopranos. The old single-column PK made movie/TV upserts overwrite
 * each other's title/poster/metadata (the reported "Stalker shows Sopranos metadata" bug).
 *
 * Kept in its own module (no side effects) so scripts/migrate-media-db.ts can run the
 * exact same migration against a prod database file without importing lib/db.ts
 * (which opens the app's default database on import).
 *
 * IMPORTANT HISTORY (the media_legacy incident):
 * The first implementation used `ALTER TABLE media RENAME TO media_legacy` … `DROP TABLE
 * media_legacy`. SQLite's RENAME — with legacy_alter_table OFF (default) — REWRITES foreign
 * key clauses in OTHER tables that reference the renamed table, so
 * tv_episodes' `REFERENCES media(tmdb_id)` became `REFERENCES "media_legacy"(tmdb_id)`.
 * Dropping media_legacy then left a dangling FK parent, and with `PRAGMA foreign_keys = ON`
 * every write statement failed with "no such table: main.media_legacy".
 * Two guards now prevent this:
 *   1. Migrations run with `PRAGMA legacy_alter_table = ON` (RENAME never rewrites FKs)
 *      and `PRAGMA foreign_keys = OFF` (FK parent must not cascade-drop data mid-migration).
 *   2. ensureForeignKeysRepair() detects and rebuilds any table whose FK still references
 *      the temporary name — self-heals databases damaged by the old implementation.
 */

interface SqliteHandle {
  query(sql: string): { run(...args: any[]): unknown; all(...args: any[]): unknown[]; get(...args: any[]): unknown };
  exec(sql: string): unknown;
  // bun:sqlite's transaction() has extra properties (deferred/immediate/exclusive),
  // so the generic is kept loose on purpose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any;
}

/** Set migration-safe pragma state; returns the previous values for restoration. */
function setMigrationPragmas(database: SqliteHandle): { fk: unknown; legacy: unknown } {
  const fk = (database.query("PRAGMA foreign_keys").get() as any)?.foreign_keys;
  const legacy = (database.query("PRAGMA legacy_alter_table").get() as any)?.legacy_alter_table;
  // foreign_keys is a no-op inside a transaction — must be set before BEGIN.
  database.query("PRAGMA foreign_keys = OFF").run();
  database.query("PRAGMA legacy_alter_table = ON").run();
  return { fk, legacy };
}

function restorePragmas(database: SqliteHandle, prev: { fk: unknown; legacy: unknown }) {
  database.query(`PRAGMA foreign_keys = ${prev.fk ? "ON" : "OFF"}`).run();
  database.query(`PRAGMA legacy_alter_table = ${prev.legacy ? "ON" : "OFF"}`).run();
}

export function mediaTableNeedsCompositeKeyMigration(database: SqliteHandle): boolean {
  const info = database.query("PRAGMA table_info(media)").all() as {
    name: string;
    pk: number;
  }[];
  if (info.length === 0) return false; // table doesn't exist yet — fresh install path
  const pkCols = info.filter((c) => c.pk > 0).map((c) => c.name);
  return pkCols.length === 1 && pkCols[0] === "tmdb_id";
}

/**
 * Rebuild the media table with PRIMARY KEY (tmdb_id, media_type).
 * Idempotent — no-op when the table is already migrated or doesn't exist.
 * Runs with legacy_alter_table=ON so the temporary rename does NOT rewrite FK
 * clauses in other tables (see the media_legacy incident note above).
 */
export function ensureMediaCompositeKeyMigration(database: SqliteHandle): boolean {
  if (!mediaTableNeedsCompositeKeyMigration(database)) return false;

  const prev = setMigrationPragmas(database);
  try {
    const migrate = database.transaction(() => {
      database.query("ALTER TABLE media RENAME TO media_legacy").run();
      database
        .query(
          `CREATE TABLE media (
          tmdb_id      INTEGER NOT NULL,
          title        TEXT    NOT NULL,
          year         TEXT,
          poster_url   TEXT,
          backdrop_url TEXT,
          overview     TEXT,
          media_type   TEXT    NOT NULL DEFAULT 'movie',
          updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (tmdb_id, media_type)
        )`
        )
        .run();
      database
        .query(
          `INSERT INTO media (tmdb_id, title, year, poster_url, backdrop_url, overview, media_type, updated_at)
         SELECT tmdb_id, title, year, poster_url, backdrop_url, overview, media_type, updated_at
         FROM media_legacy`
        )
        .run();
      database.query("DROP TABLE media_legacy").run();
    });
    migrate();
  } finally {
    restorePragmas(database, prev);
  }
  return true;
}

/**
 * Self-heal for two kinds of FK damage caused by earlier versions of the composite-PK
 * migration, found by scanning sqlite_master:
 *
 *  1. Dangling reference: a table's FK still points at the temporary "media_legacy"
 *     table that was renamed + dropped ("no such table: main.media_legacy" on writes).
 *  2. Invalid single-column reference: a table's FK references `media(tmdb_id)` alone.
 *     media's PK is the composite (tmdb_id, media_type), so a one-column child key
 *     doesn't match any unique index of the parent — SQLite raises
 *     "foreign key mismatch" on any write once foreign_keys = ON.
 *
 * Damaged tables are rebuilt with the offending FK removed (referential integrity is
 * enforced by app logic — sync inserts media rows before episodes/files).
 * Idempotent — a no-op on healthy databases (one sqlite_master scan).
 */
export function ensureForeignKeysRepair(database: SqliteHandle): string[] {
  const tables = database
    .query("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL")
    .all() as { name: string; sql: string }[];

  const damaged = tables.filter(
    (t) =>
      !t.name.startsWith("sqlite_") &&
      t.name !== "media" &&
      (/REFERENCES\s+"?media_legacy"?/.test(t.sql) ||
        // `media(tmdb_id, media_type)` is valid; `media(tmdb_id)` alone is not
        /REFERENCES\s+"?media"?\s*\(\s*tmdb_id\s*\)/.test(t.sql))
  );

  if (damaged.length === 0) return [];

  const prev = setMigrationPragmas(database);
  const repaired: string[] = [];
  try {
    for (const t of damaged) {
      const fixedSql = t.sql
        // Step 1: repoint any surviving media_legacy references back to media
        .replace(/"?media_legacy"?/g, "media")
        // Step 2: strip FKs that reference media by tmdb_id alone (invalid parent key
        // against the composite PK). Optionally consumes a trailing ON DELETE clause.
        .replace(
          /REFERENCES\s+"?media"?\s*\(\s*tmdb_id\s*\)\s*(ON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT))?\s*(ON\s+UPDATE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT))?/gi,
          ""
        );
      const rebuild = database.transaction(() => {
        database.query(`ALTER TABLE ${t.name} RENAME TO ${t.name}__broken`).run();
        database.query(fixedSql).run();
        database.query(`INSERT INTO ${t.name} SELECT * FROM ${t.name}__broken`).run();
        database.query(`DROP TABLE ${t.name}__broken`).run();
      });
      rebuild();
      repaired.push(t.name);
    }
  } finally {
    restorePragmas(database, prev);
  }
  return repaired;
}
