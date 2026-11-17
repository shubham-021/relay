import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureMediaCompositeKeyMigration,
  mediaTableNeedsCompositeKeyMigration,
  ensureForeignKeysRepair,
} from "./media-migration";

let db: Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "media-migration-test-"));
  db = new Database(join(dir, "test.sqlite"));
  db.query("PRAGMA foreign_keys = ON").run();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Schema as it looked BEFORE the composite-PK work: single-column PK + FKs to media. */
function createLegacySchema(database: Database) {
  database.query("PRAGMA foreign_keys = OFF").run();
  database.exec(`
    CREATE TABLE media (
      tmdb_id    INTEGER PRIMARY KEY,
      title      TEXT NOT NULL,
      year       TEXT,
      poster_url TEXT,
      backdrop_url TEXT,
      overview   TEXT,
      media_type TEXT NOT NULL DEFAULT 'movie',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE tv_episodes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      show_tmdb_id   INTEGER NOT NULL REFERENCES media(tmdb_id) ON DELETE CASCADE,
      season_number  INTEGER NOT NULL,
      episode_number INTEGER NOT NULL,
      episode_title  TEXT,
      overview       TEXT,
      still_url      TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(show_tmdb_id, season_number, episode_number)
    );
    INSERT INTO media (tmdb_id, title, year, media_type) VALUES
      (1398, 'Stalker', '1979', 'movie'),
      (522815, 'Enemy', '2013', 'movie');
    INSERT INTO tv_episodes (show_tmdb_id, season_number, episode_number, episode_title) VALUES
      (1398, 1, 1, 'Pilot'), (1398, 1, 2, '46 Long');
  `);
  database.query("PRAGMA foreign_keys = ON").run();
}

describe("ensureMediaCompositeKeyMigration", () => {
  test("rebuilds single-column PK into composite (tmdb_id, media_type), preserving rows", () => {
    createLegacySchema(db);
    expect(mediaTableNeedsCompositeKeyMigration(db)).toBe(true);

    expect(ensureMediaCompositeKeyMigration(db)).toBe(true);

    const pk = (db.query("PRAGMA table_info(media)").all() as any[])
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    expect(pk).toEqual(["tmdb_id", "media_type"]);

    const rows = db.query("SELECT tmdb_id, title, media_type FROM media ORDER BY tmdb_id").all();
    expect(rows).toHaveLength(2);

    // both categories can now coexist on the same tmdb_id
    db.query(
      `INSERT INTO media (tmdb_id, title, year, media_type) VALUES (1398, 'The Sopranos', '1999', 'tv')`
    ).run();
    expect(db.query("SELECT COUNT(*) c FROM media WHERE tmdb_id = 1398").get()).toEqual({ c: 2 });
  });

  test("is idempotent (no-op when already migrated)", () => {
    createLegacySchema(db);
    ensureMediaCompositeKeyMigration(db);
    expect(mediaTableNeedsCompositeKeyMigration(db)).toBe(false);
    expect(ensureMediaCompositeKeyMigration(db)).toBe(false);
  });

  test("leaves no media_legacy references behind (the FK-rewrite incident)", () => {
    createLegacySchema(db);
    ensureMediaCompositeKeyMigration(db);

    // With legacy_alter_table=ON the RENAME must not rewrite FK clauses in other
    // tables — tv_episodes must still reference media, not the dropped temp table.
    const refs = db
      .query("SELECT sql FROM sqlite_master WHERE sql LIKE '%media_legacy%'")
      .all();
    expect(refs).toHaveLength(0);

    // NOTE: tv_episodes' pre-existing single-column `REFERENCES media(tmdb_id)` FK is
    // now a "foreign key mismatch" against the composite PK — that variant is repaired
    // by ensureForeignKeysRepair (see its describe block). The two steps run together
    // at startup (lib/db.ts) and in scripts/migrate-media-db.ts.
    ensureForeignKeysRepair(db);
    expect(() =>
      db
        .query(
          `INSERT INTO tv_episodes (show_tmdb_id, season_number, episode_number) VALUES (522815, 1, 1)`
        )
        .run()
    ).not.toThrow();
  });
});

describe("ensureForeignKeysRepair", () => {
  test("repairs tables whose FK was rewritten to the dropped media_legacy table", () => {
    // Simulate the exact damage the old migration caused.
    createLegacySchema(db);
    db.query("PRAGMA foreign_keys = OFF").run();
    db.exec(`ALTER TABLE media RENAME TO media_legacy`); // rewrites tv_episodes' FK
    db.exec(`
      CREATE TABLE media (
        tmdb_id    INTEGER NOT NULL,
        title      TEXT NOT NULL,
        year       TEXT,
        poster_url TEXT,
        backdrop_url TEXT,
        overview   TEXT,
        media_type TEXT NOT NULL DEFAULT 'movie',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tmdb_id, media_type)
      );
      INSERT INTO media (tmdb_id, title, year, media_type)
        SELECT tmdb_id, title, year, media_type FROM media_legacy;
      DROP TABLE media_legacy;
    `);
    db.query("PRAGMA foreign_keys = ON").run();

    const repaired = ensureForeignKeysRepair(db);
    expect(repaired).toEqual(["tv_episodes"]);
    expect(db.query("SELECT COUNT(*) c FROM sqlite_master WHERE sql LIKE '%media_legacy%'").get()).toEqual({ c: 0 });
    expect(db.query("SELECT COUNT(*) c FROM tv_episodes").get()).toEqual({ c: 2 });
    // writes work again with foreign_keys = ON
    expect(() => db.query("DELETE FROM tv_episodes WHERE episode_number = 2").run()).not.toThrow();
  });

  test("strips invalid single-column FKs to composite-PK media (foreign key mismatch)", () => {
    createLegacySchema(db);
    ensureMediaCompositeKeyMigration(db); // media now has composite PK...
    // ...but tv_episodes still references media(tmdb_id) alone → mismatch
    const sql = (db.query("SELECT sql FROM sqlite_master WHERE name = 'tv_episodes'").get() as any).sql;
    expect(sql).toMatch(/REFERENCES\s+media\s*\(\s*tmdb_id\s*\)/);

    const repaired = ensureForeignKeysRepair(db);
    expect(repaired).toEqual(["tv_episodes"]);
    const after = (db.query("SELECT sql FROM sqlite_master WHERE name = 'tv_episodes'").get() as any).sql;
    expect(after).not.toMatch(/REFERENCES\s+media\s*\(/);
    expect(db.query("SELECT COUNT(*) c FROM tv_episodes").get()).toEqual({ c: 2 });
    expect(db.query("PRAGMA foreign_key_check").all()).toHaveLength(0);
  });

  test("is a no-op on healthy databases", () => {
    createLegacySchema(db);
    ensureMediaCompositeKeyMigration(db);
    ensureForeignKeysRepair(db);
    expect(ensureForeignKeysRepair(db)).toEqual([]);
    expect(db.query("PRAGMA foreign_key_check").all()).toHaveLength(0);
  });
});
