/**
 * scripts/migrate-media-db.ts
 * Prod migration + repair for the TMDB ID collision bug (LIB_FIX_PLAN.md Phase 1.3).
 *
 * What it does:
 *  1. Rebuilds the `media` table with PRIMARY KEY (tmdb_id, media_type) if it still has
 *     the old single-column PK. tmdb_id alone is NOT unique across TMDB categories:
 *     movie/1398 = Stalker (1979), tv/1398 = The Sopranos — the old schema made the two
 *     categories overwrite each other's metadata on every upsert.
 *  2. Repair pass: for every (tmdb_id, media_type) referenced by files in
 *     remote_list_cache, verifies the corresponding media row exists AND its title
 *     matches what the parser stored. On mismatch/missing, re-resolves via TMDB and
 *     - creates the missing media row (fixes Stalker/Sopranos sharing id 1398), and/or
 *     - repoints file rows to the correct tmdb_id (fixes e.g. "Enemy" matched to
 *       "Enemy Empire"). Repointing only happens when TMDB returns a confident match
 *       (normalized title equality), so nothing is blindly rewritten.
 *
 * Usage:
 *   TMDB_API_KEY=... bun scripts/migrate-media-db.ts [path-to-metadata.sqlite]
 *   (db path defaults to ./data/metadata.sqlite)
 *
 * Safe to re-run: the migration is idempotent and the repair pass only rewrites rows
 * whose stored state disagrees with a confident TMDB resolution.
 */

import { Database } from "bun:sqlite";
import {
  ensureMediaCompositeKeyMigration,
  mediaTableNeedsCompositeKeyMigration,
  ensureForeignKeysRepair,
} from "../lib/media-migration";
import { searchTmdbMovie, searchTmdbTv, normalizeTitle } from "../lib/tmdb";

const dbPath = process.argv[2] ?? "./data/metadata.sqlite";

if (!process.env.TMDB_API_KEY) {
  console.error("TMDB_API_KEY env var is required (needed for the repair pass).");
  process.exit(1);
}

console.log(`Opening ${dbPath} ...`);
const database = new Database(dbPath);
database.query("PRAGMA journal_mode = WAL").run();
database.query("PRAGMA busy_timeout = 5000").run();

// ── Step 1: composite-PK migration ──────────────────────────────────────────────

if (mediaTableNeedsCompositeKeyMigration(database)) {
  console.log("[migrate] old media schema detected (single-column PK on tmdb_id)");
  const changed = ensureMediaCompositeKeyMigration(database);
  console.log(changed
    ? "[migrate] media table rebuilt with PRIMARY KEY (tmdb_id, media_type)"
    : "[migrate] no migration needed");
} else {
  console.log("[migrate] media schema already up to date");
}

// ── Step 1b: self-heal invalid foreign keys ─────────────────────────────────────
// Must run AFTER the composite-PK migration (that migration is what turns pre-existing
// single-column `REFERENCES media(tmdb_id)` FKs into "foreign key mismatch" errors),
// and it also repairs dangling `REFERENCES "media_legacy"` FKs left by an older
// version of the migration ("no such table: main.media_legacy" on every write).
const repaired = ensureForeignKeysRepair(database);
if (repaired.length > 0) {
  console.log(`[migrate] repaired invalid foreign keys in: ${repaired.join(", ")}`);
}

interface UpsertMediaShape {
  tmdb_id: number;
  media_type: string;
  title: string;
  year: string;
  poster_url: string;
  backdrop_url: string;
  overview: string | null;
}

function upsertMediaRow(m: {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
}) {
  database
    .query(
      `INSERT INTO media (tmdb_id, title, year, poster_url, media_type, backdrop_url, overview, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
         title = excluded.title,
         year = excluded.year,
         poster_url = excluded.poster_url,
         backdrop_url = COALESCE(excluded.backdrop_url, media.backdrop_url),
         overview = COALESCE(excluded.overview, media.overview),
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(
      m.id,
      m.title,
      m.year,
      m.posterPath ? `https://image.tmdb.org/t/p/w500${m.posterPath}` : "",
      m.mediaType,
      m.backdropPath ? `https://image.tmdb.org/t/p/w1280${m.backdropPath}` : "",
      m.overview
    );
}

// ── Step 2: repair pass ─────────────────────────────────────────────────────────

interface FileGroup {
  tmdb_id: number;
  file_type: "movie" | "tv";
  files: number;
  raw_title: string;
  raw_year: string | null;
}

const groups = database
  .query(
    `SELECT r.tmdb_id, r.media_type AS file_type, COUNT(*) AS files,
            r.raw_title, MAX(r.raw_year) AS raw_year
     FROM remote_list_cache r
     WHERE r.tmdb_id IS NOT NULL AND r.media_type IN ('movie', 'tv') AND r.raw_title IS NOT NULL
     GROUP BY r.tmdb_id, r.media_type, r.raw_title
     ORDER BY files DESC`
  )
  .all() as unknown as (FileGroup & { raw_year: string | null })[];

// Collapse to one representative title (most common) per (tmdb_id, file_type)
const byKey = new Map<string, FileGroup>();
for (const g of groups) {
  const key = `${g.tmdb_id}:${g.file_type}`;
  const existing = byKey.get(key);
  if (!existing || g.files > existing.files) {
    byKey.set(key, { ...g });
  }
}

console.log(`[repair] ${byKey.size} distinct (tmdb_id, media_type) references found\n`);

let missingCreated = 0;
let repointed = 0;
let titleFixed = 0;
let checked = 0;
let errors = 0;

for (const [key, g] of byKey) {
  checked++;
  const mediaRow = database
    .query("SELECT tmdb_id, title, year, media_type FROM media WHERE tmdb_id = ? AND media_type = ?")
    .get(g.tmdb_id, g.file_type) as UpsertMediaShape | null;

  const parsedNorm = normalizeTitle(g.raw_title);
  if (!parsedNorm) continue;

  const needsResolve =
    !mediaRow || normalizeTitle(mediaRow.title) !== parsedNorm;

  if (!needsResolve) continue;

  const reason = mediaRow
    ? `media row title "${mediaRow.title}" != parsed title "${g.raw_title}"`
    : `no media row for (${g.tmdb_id}, ${g.file_type})`;
  console.log(`[repair] ${key} (${g.files} files): ${reason} — re-resolving "${g.raw_title}" (${g.raw_year ?? "no year"})...`);

  try {
    const outcome =
      g.file_type === "movie"
        ? await searchTmdbMovie(g.raw_title, g.raw_year ?? undefined)
        : await searchTmdbTv(g.raw_title, g.raw_year ?? undefined);

    if (outcome.status !== "match") {
      console.log(`         no confident TMDB match (${outcome.status}) — leaving rows untouched`);
      continue;
    }

    const match = outcome.result;
    const matchNorm = normalizeTitle(match.title);
    if (matchNorm !== parsedNorm) {
      // TMDB returned a different title than the parser found — not confident enough
      // to rewrite automatically.
      console.log(`         TMDB returned "${match.title}" (${match.id}) — title mismatch, leaving rows untouched`);
      continue;
    }

    upsertMediaRow({
      id: match.id,
      mediaType: g.file_type,
      title: match.title,
      year: match.year,
      posterPath: match.posterPath,
      backdropPath: match.backdropPath,
      overview: match.overview,
    });
    if (!mediaRow) {
      missingCreated++;
      console.log(`         created media row (${match.id}, ${g.file_type}) "${match.title}"`);
    } else if (mediaRow.tmdb_id !== match.id) {
      titleFixed++;
    }

    if (match.id !== g.tmdb_id) {
      // Repoint file rows that were matched into the wrong id
      const res = database
        .query(
          `UPDATE remote_list_cache SET tmdb_id = ? WHERE tmdb_id = ? AND media_type = ?`
        )
        .run(match.id, g.tmdb_id, g.file_type);
      const count = (res as any)?.changes ?? 0;
      if (count > 0) {
        repointed += count;
        console.log(`         repointed ${count} file row(s) ${g.tmdb_id} → ${match.id}`);
      }
    }
  } catch (e) {
    errors++;
    console.error(`         TMDB resolution failed:`, e);
  }
}

console.log(`\n[summary] checked ${checked} references`);
console.log(`[summary] media rows created: ${missingCreated}`);
console.log(`[summary] file rows repointed: ${repointed}`);
console.log(`[summary] titles corrected: ${titleFixed}`);
if (errors > 0) console.log(`[summary] TMDB errors: ${errors} (re-run the script to retry)`);

database.close();
console.log("\nDone. Next: restart the app (startup migration is idempotent) and resync accounts.");
