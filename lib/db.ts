import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";

if (!existsSync("./data")) {
  mkdirSync("./data", { recursive: true });
}

let db: any;

const globalForDb = globalThis as unknown as { __domaDb: any };

try {
  if (!globalForDb.__domaDb) {
    globalForDb.__domaDb = new Database("./data/metadata.sqlite", { create: true });

    // Enable WAL mode and set busy timeout for better concurrent read/write performance
    globalForDb.__domaDb.query("PRAGMA journal_mode = WAL").run();
    globalForDb.__domaDb.query("PRAGMA busy_timeout = 5000").run();
    globalForDb.__domaDb.query("PRAGMA foreign_keys = ON").run();

    // Schema Migration: detect old schema and migrate 
    // Check if accounts table has old webdav columns
    try {
      const tableInfo = globalForDb.__domaDb
        .query("PRAGMA table_info(accounts)")
        .all() as { name: string }[];
      const columnNames = tableInfo.map((c) => c.name);

      if (columnNames.includes("webdav_username")) {
        // Old schema detected - drop and recreate accounts + remote_list_cache
        console.log("[DB Migration] Old WebDAV schema detected — migrating to TorBox API schema...");
        globalForDb.__domaDb.query("DROP TABLE IF EXISTS user_accounts").run();
        globalForDb.__domaDb.query("DROP TABLE IF EXISTS remote_list_cache").run();
        globalForDb.__domaDb.query("DROP TABLE IF EXISTS tv_episodes").run();
        globalForDb.__domaDb.query("DROP TABLE IF EXISTS media").run();
        globalForDb.__domaDb.query("DROP TABLE IF EXISTS accounts").run();
        console.log("[DB Migration] Old tables dropped. Recreating with new schema...");
      }
    } catch (_) {
      // No existing accounts table — fresh install
    }

    // users
    globalForDb.__domaDb
      .query(
        `
      CREATE TABLE IF NOT EXISTS users (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        username  TEXT    NOT NULL UNIQUE,
        password  TEXT    NOT NULL,          -- bcrypt hash
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
      )
      .run();

    // accounts (TorBox accounts)
    globalForDb.__domaDb
      .query(
        `
      CREATE TABLE IF NOT EXISTS accounts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        torbox_email     TEXT    NOT NULL,
        torbox_password  TEXT    NOT NULL,          -- AES-256-GCM encrypted
        access_token     TEXT,
        refresh_token    TEXT,
        token_expires_at INTEGER,                   -- unix timestamp (seconds)
        last_synced_at   DATETIME,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(torbox_email)
      )
    `
      )
      .run();

    // user_accounts (Junction Table)
    globalForDb.__domaDb
      .query(
        `
      CREATE TABLE IF NOT EXISTS user_accounts (
        user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        is_active        INTEGER NOT NULL DEFAULT 1,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, account_id)
      )
    `
      )
      .run();

    // media
    globalForDb.__domaDb
      .query(
        `
      CREATE TABLE IF NOT EXISTS media (
        tmdb_id      INTEGER PRIMARY KEY,
        title        TEXT    NOT NULL,
        year         TEXT,
        poster_url   TEXT,
        backdrop_url TEXT,
        overview     TEXT,
        media_type   TEXT    NOT NULL DEFAULT 'movie', -- 'movie' | 'tv'
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
      )
      .run();

    // remote_list_cache
    globalForDb.__domaDb
      .query(
        `
      CREATE TABLE IF NOT EXISTS remote_list_cache (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id         INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        torrent_id         INTEGER NOT NULL,
        file_id            INTEGER NOT NULL,
        remote_path        TEXT    NOT NULL,          -- files[].name from TorBox API
        filename           TEXT    NOT NULL,          -- basename
        short_name         TEXT,
        size               INTEGER NOT NULL DEFAULT 0,
        mime_type          TEXT,
        torrent_hash       TEXT,
        tmdb_id            INTEGER REFERENCES media(tmdb_id) ON DELETE SET NULL,
        raw_title          TEXT,
        raw_year           TEXT,
        media_type         TEXT DEFAULT 'other',      -- 'movie' | 'tv' | 'other'
        show_title         TEXT,
        season_number      INTEGER,
        episode_number     INTEGER,
        episode_end_number INTEGER,
        parsed_year        TEXT,
        synced_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, torrent_id, file_id)
      )
    `
      )
      .run();

    // tv_episodes
    globalForDb.__domaDb
      .query(
        `
      CREATE TABLE IF NOT EXISTS tv_episodes (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        show_tmdb_id   INTEGER NOT NULL REFERENCES media(tmdb_id) ON DELETE CASCADE,
        season_number  INTEGER NOT NULL,
        episode_number INTEGER NOT NULL,
        episode_title  TEXT,
        overview       TEXT,
        still_url      TEXT,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(show_tmdb_id, season_number, episode_number)
      )
    `
      )
      .run();

    // metadata_cache (legacy)
    globalForDb.__domaDb
      .query(
        `
      CREATE TABLE IF NOT EXISTS metadata_cache (
        filename TEXT PRIMARY KEY,
        title TEXT,
        year TEXT,
        poster_url TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
      )
      .run();

    // user_watched (resume/continue-watching positions, mpv only for now)
    globalForDb.__domaDb
      .query(
        `
      CREATE TABLE IF NOT EXISTS user_watched (
        user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        torrent_id       INTEGER NOT NULL,
        file_id          INTEGER NOT NULL,
        position_seconds REAL    NOT NULL DEFAULT 0,
        duration_seconds REAL,
        completed        INTEGER NOT NULL DEFAULT 0,
        last_updated     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, account_id, torrent_id, file_id)
      )
    `
      )
      .run();

    // file_thumbnails (video thumbnail previews for "other" files)
    globalForDb.__domaDb
      .query(
        `
      CREATE TABLE IF NOT EXISTS file_thumbnails (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        torrent_id  INTEGER NOT NULL,
        file_id     INTEGER NOT NULL,
        position    INTEGER NOT NULL CHECK(position BETWEEN 1 AND 5),
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, torrent_id, file_id, position)
      )
    `
      )
      .run();

    globalForDb.__domaDb
      .query(
        `CREATE INDEX IF NOT EXISTS idx_file_thumbnails_lookup
         ON file_thumbnails(account_id, torrent_id, file_id)`
      )
      .run();

    // torrents (parent table for torrent-level metadata)
    globalForDb.__domaDb
      .query(
        `
      CREATE TABLE IF NOT EXISTS torrents (
        account_id         INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        torrent_id         INTEGER NOT NULL,
        torrent_name       TEXT,
        torrent_hash       TEXT,
        primary_media_type TEXT DEFAULT 'other',
        primary_title      TEXT,
        tmdb_id            INTEGER REFERENCES media(tmdb_id) ON DELETE SET NULL,
        synced_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, torrent_id)
      )
    `
      )
      .run();

    // Safe column additions for existing databases (idempotent)
    try { globalForDb.__domaDb.query("ALTER TABLE media ADD COLUMN backdrop_url TEXT").run(); } catch (_) { }
    try { globalForDb.__domaDb.query("ALTER TABLE media ADD COLUMN overview TEXT").run(); } catch (_) { }
    try { globalForDb.__domaDb.query("ALTER TABLE user_watched ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0").run(); } catch (_) { }
  }

  db = globalForDb.__domaDb;
} catch (error) {
  console.error("Failed to initialize bun:sqlite:", error);
}

export function getDb() {
  return db;
}

// users

export function getUserByUsername(username: string) {
  if (!db) return null;
  try {
    return db.query("SELECT * FROM users WHERE username = ?").get(username) as any;
  } catch (e) {
    console.error("getUserByUsername error:", e);
    return null;
  }
}

export function getUserById(id: number) {
  if (!db) return null;
  try {
    return db.query("SELECT * FROM users WHERE id = ?").get(id) as any;
  } catch (e) {
    console.error("getUserById error:", e);
    return null;
  }
}

export function createUser(username: string, hashedPassword: string): number | null {
  if (!db) return null;
  try {
    const result = db
      .query("INSERT INTO users (username, password) VALUES (?, ?)")
      .run(username, hashedPassword);
    return result.lastInsertRowid as number;
  } catch (e) {
    console.error("createUser error:", e);
    return null;
  }
}

// accounts

export function getAccountsByUserId(userId: number) {
  if (!db) return [];
  try {
    return db
      .query(`
        SELECT a.id, a.torbox_email, a.last_synced_at, ua.is_active 
        FROM accounts a
        JOIN user_accounts ua ON ua.account_id = a.id
        WHERE ua.user_id = ?
        ORDER BY a.created_at ASC
      `)
      .all(userId) as any[];
  } catch (e) {
    console.error("getAccountsByUserId error:", e);
    return [];
  }
}

export function getAccountById(accountId: number) {
  if (!db) return null;
  try {
    return db.query("SELECT * FROM accounts WHERE id = ?").get(accountId) as any;
  } catch (e) {
    console.error("getAccountById error:", e);
    return null;
  }
}

export function verifyUserAccountAccess(userId: number, accountId: number): boolean {
  if (!db) return false;
  try {
    const link = db.query("SELECT 1 FROM user_accounts WHERE user_id = ? AND account_id = ?").get(userId, accountId);
    return !!link;
  } catch (e) {
    console.error("verifyUserAccountAccess error:", e);
    return false;
  }
}

export function getAccountByEmail(userId: number, torboxEmail: string) {
  if (!db) return null;
  try {
    return db
      .query(`
        SELECT a.*, ua.is_active 
        FROM accounts a
        JOIN user_accounts ua ON ua.account_id = a.id
        WHERE ua.user_id = ? AND a.torbox_email = ?
      `)
      .get(userId, torboxEmail) as any;
  } catch (e) {
    console.error("getAccountByEmail error:", e);
    return null;
  }
}

export function createAccount(
  userId: number,
  torboxEmail: string,
  encryptedPassword: string,
  accessToken?: string,
  refreshToken?: string,
  tokenExpiresAt?: number
): number | null {
  if (!db) return null;
  try {
    const user = getUserById(userId);
    if (!user) return null;

    let account = db.query("SELECT * FROM accounts WHERE torbox_email = ? LIMIT 1").get(torboxEmail) as any;

    if (!account) {
      // Create new TorBox account
      const result = db
        .query(
          `INSERT INTO accounts (torbox_email, torbox_password, access_token, refresh_token, token_expires_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          torboxEmail,
          encryptedPassword,
          accessToken ?? null,
          refreshToken ?? null,
          tokenExpiresAt ?? null
        );

      account = db.query("SELECT * FROM accounts WHERE id = ?").get(result.lastInsertRowid) as any;
    } else {
      // Account already exists — update password and tokens
      db.query(
        `UPDATE accounts 
         SET torbox_password = ?, access_token = ?, refresh_token = ?, token_expires_at = ?
         WHERE id = ?`
      ).run(
        encryptedPassword,
        accessToken ?? null,
        refreshToken ?? null,
        tokenExpiresAt ?? null,
        account.id
      );
    }

    // Link the user to the account 
    db.query(`
      INSERT INTO user_accounts (user_id, account_id, is_active) 
      VALUES (?, ?, 1) 
      ON CONFLICT(user_id, account_id) DO UPDATE SET is_active = 1
    `).run(userId, account.id);

    return account.id;
  } catch (e) {
    console.error("createAccount error:", e);
    return null;
  }
}

export function updateAccountTokens(
  accountId: number,
  accessToken: string,
  refreshToken: string,
  tokenExpiresAt: number
) {
  if (!db) return;
  try {
    db.query(
      `UPDATE accounts 
       SET access_token = ?, refresh_token = ?, token_expires_at = ?
       WHERE id = ?`
    ).run(accessToken, refreshToken, tokenExpiresAt, accountId);
  } catch (e) {
    console.error("updateAccountTokens error:", e);
  }
}

export function updateAccountSyncTime(accountId: number) {
  if (!db) return;
  try {
    db.query("UPDATE accounts SET last_synced_at = CURRENT_TIMESTAMP WHERE id = ?").run(accountId);
  } catch (e) {
    console.error("updateAccountSyncTime error:", e);
  }
}

// media & tv_episodes

export function getMediaByTmdbId(tmdbId: number) {
  if (!db) return null;
  try {
    return db.query("SELECT * FROM media WHERE tmdb_id = ?").get(tmdbId) as any;
  } catch (e) {
    console.error("getMediaByTmdbId error:", e);
    return null;
  }
}

export function upsertMedia(
  tmdbId: number,
  title: string,
  year: string,
  posterUrl: string,
  mediaType: "movie" | "tv",
  backdropUrl?: string | null,
  overview?: string | null
) {
  if (!db) return;
  try {
    db.query(
      `INSERT INTO media (tmdb_id, title, year, poster_url, media_type, backdrop_url, overview, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(tmdb_id) DO UPDATE SET
         title        = excluded.title,
         year         = excluded.year,
         poster_url   = excluded.poster_url,
         media_type   = excluded.media_type,
         backdrop_url = COALESCE(excluded.backdrop_url, media.backdrop_url),
         overview     = COALESCE(excluded.overview, media.overview),
         updated_at   = CURRENT_TIMESTAMP`
    ).run(tmdbId, title, year, posterUrl, mediaType, backdropUrl ?? null, overview ?? null);
  } catch (e) {
    console.error("upsertMedia error:", e);
  }
}

export function upsertTvEpisode(
  showTmdbId: number,
  seasonNumber: number,
  episodeNumber: number,
  episodeTitle?: string | null,
  overview?: string | null,
  stillUrl?: string | null
) {
  if (!db) return;
  try {
    db.query(
      `INSERT INTO tv_episodes (show_tmdb_id, season_number, episode_number, episode_title, overview, still_url)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(show_tmdb_id, season_number, episode_number) DO UPDATE SET
         episode_title = COALESCE(excluded.episode_title, tv_episodes.episode_title),
         overview      = COALESCE(excluded.overview, tv_episodes.overview),
         still_url     = COALESCE(excluded.still_url, tv_episodes.still_url)`
    ).run(showTmdbId, seasonNumber, episodeNumber, episodeTitle ?? null, overview ?? null, stillUrl ?? null);
  } catch (e) {
    console.error("upsertTvEpisode error:", e);
  }
}

// remote_list_cache

export function upsertRemoteFile(
  accountId: number,
  torrentId: number,
  fileId: number,
  remotePath: string,
  filename: string,
  shortName: string | null,
  size: number,
  mimeType: string,
  torrentHash: string | null,
  tmdbId: number | null,
  rawTitle: string | null,
  rawYear: string | null,
  mediaType: "movie" | "tv" | "other" = "other",
  showTitle: string | null = null,
  seasonNumber: number | null = null,
  episodeNumber: number | null = null,
  episodeEndNumber: number | null = null,
  parsedYear: string | null = null
) {
  if (!db) return;
  try {
    db.query(
      `INSERT INTO remote_list_cache
         (account_id, torrent_id, file_id, remote_path, filename, short_name, size, mime_type, torrent_hash, tmdb_id, raw_title, raw_year, media_type, show_title, season_number, episode_number, episode_end_number, parsed_year, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(account_id, torrent_id, file_id) DO UPDATE SET
         remote_path        = excluded.remote_path,
         filename           = excluded.filename,
         short_name         = excluded.short_name,
         size               = excluded.size,
         mime_type          = excluded.mime_type,
         torrent_hash       = excluded.torrent_hash,
         tmdb_id            = excluded.tmdb_id,
         raw_title          = excluded.raw_title,
         raw_year           = excluded.raw_year,
         media_type         = excluded.media_type,
         show_title         = excluded.show_title,
         season_number      = excluded.season_number,
         episode_number     = excluded.episode_number,
         episode_end_number = excluded.episode_end_number,
         parsed_year        = excluded.parsed_year,
         synced_at          = CURRENT_TIMESTAMP`
    ).run(
      accountId,
      torrentId,
      fileId,
      remotePath,
      filename,
      shortName,
      size,
      mimeType,
      torrentHash,
      tmdbId,
      rawTitle,
      rawYear,
      mediaType,
      showTitle,
      seasonNumber,
      episodeNumber,
      episodeEndNumber,
      parsedYear
    );
  } catch (e) {
    console.error("upsertRemoteFile error:", e);
  }
}

export function getFilesForAccount(accountId: number) {
  if (!db) return [];
  try {
    return db
      .query(
        `SELECT
           r.id,
           r.account_id,
           r.torrent_id,
           r.file_id,
           r.remote_path,
           r.filename,
           r.short_name,
           r.size,
           r.mime_type,
           r.tmdb_id,
           r.raw_title,
           r.raw_year,
           r.media_type,
           r.show_title,
           r.season_number,
           r.episode_number,
           r.synced_at,
           m.title       AS media_title,
           m.year        AS media_year,
           m.poster_url  AS media_poster_url
         FROM remote_list_cache r
         LEFT JOIN media m ON r.tmdb_id = m.tmdb_id
         WHERE r.account_id = ?
         ORDER BY COALESCE(m.title, r.show_title, r.raw_title, r.filename) ASC`
      )
      .all(accountId) as any[];
  } catch (e) {
    console.error("getFilesForAccount error:", e);
    return [];
  }
}

export function getMoviesForAccount(accountId: number) {
  if (!db) return [];
  try {
    return db
      .query(
        `SELECT
           r.id,
           r.account_id,
           r.torrent_id,
           r.file_id,
           r.remote_path,
           r.filename,
           r.short_name,
           r.size,
           r.mime_type,
           r.tmdb_id,
           r.raw_title,
           r.raw_year,
           r.parsed_year,
           r.synced_at,
           m.title        AS media_title,
           m.year         AS media_year,
           m.poster_url   AS media_poster_url,
           m.backdrop_url AS media_backdrop_url,
           m.overview     AS media_overview
         FROM remote_list_cache r
         LEFT JOIN media m ON r.tmdb_id = m.tmdb_id
         WHERE r.account_id = ? AND r.media_type = 'movie'
         ORDER BY COALESCE(m.title, r.raw_title, r.filename) ASC`
      )
      .all(accountId) as any[];
  } catch (e) {
    console.error("getMoviesForAccount error:", e);
    return [];
  }
}

export function getTvShowsForAccount(accountId: number) {
  if (!db) return [];
  try {
    return db
      .query(
        `SELECT
           m.tmdb_id,
           m.title AS show_title,
           m.poster_url,
           m.backdrop_url,
           m.overview,
           COUNT(DISTINCT r.season_number) AS season_count,
           COUNT(r.id) AS episode_count,
           MIN(r.parsed_year) AS start_year
         FROM media m
         JOIN remote_list_cache r ON r.tmdb_id = m.tmdb_id
         WHERE r.account_id = ? AND r.media_type = 'tv'
         GROUP BY m.tmdb_id

         UNION ALL

         SELECT
           NULL AS tmdb_id,
           COALESCE(r.show_title, r.raw_title) AS show_title,
           NULL AS poster_url,
           NULL AS backdrop_url,
           NULL AS overview,
           COUNT(DISTINCT r.season_number) AS season_count,
           COUNT(r.id) AS episode_count,
           MIN(r.parsed_year) AS start_year
         FROM remote_list_cache r
         WHERE r.account_id = ? AND r.media_type = 'tv' AND r.tmdb_id IS NULL
         GROUP BY LOWER(COALESCE(r.show_title, r.raw_title))
         ORDER BY show_title COLLATE NOCASE ASC`
      )
      .all(accountId, accountId) as any[];
  } catch (e) {
    console.error("getTvShowsForAccount error:", e);
    return [];
  }
}

export function getTvShowDetailsForAccount(accountId: number, showTitle: string) {
  if (!db) return null;
  try {
    const episodes = db
      .query(
        `SELECT
           r.id,
           r.account_id,
           r.torrent_id,
           r.file_id,
           r.remote_path,
           r.filename,
           r.short_name,
           r.size,
           r.mime_type,
           r.tmdb_id,
           r.show_title,
           r.season_number,
           r.episode_number,
           r.episode_end_number,
           r.parsed_year,
           r.synced_at,
           m.title        AS show_name,
           m.poster_url   AS show_poster_url,
           m.backdrop_url AS show_backdrop_url,
           m.overview     AS show_overview,
           e.episode_title,
           e.overview     AS episode_overview,
           e.still_url    AS episode_still_url
         FROM remote_list_cache r
         LEFT JOIN media m ON r.tmdb_id = m.tmdb_id
         LEFT JOIN tv_episodes e ON (r.tmdb_id = e.show_tmdb_id AND r.season_number = e.season_number AND r.episode_number = e.episode_number)
         WHERE r.account_id = ? AND r.media_type = 'tv' AND LOWER(COALESCE(m.title, r.show_title, r.raw_title)) = LOWER(?)
         ORDER BY r.season_number ASC, r.episode_number ASC`
      )
      .all(accountId, showTitle) as any[];

    return episodes;
  } catch (e) {
    console.error("getTvShowDetailsForAccount error:", e);
    return null;
  }
}

export function getOtherFilesForAccount(accountId: number) {
  if (!db) return [];
  try {
    return db
      .query(
        `SELECT
           r.id,
           r.account_id,
           r.torrent_id,
           r.file_id,
           r.remote_path,
           r.filename,
           r.short_name,
           r.size,
           r.mime_type,
           r.synced_at
         FROM remote_list_cache r
         WHERE r.account_id = ? AND (r.media_type = 'other' OR r.media_type IS NULL)
         ORDER BY r.filename ASC`
      )
      .all(accountId) as any[];
  } catch (e) {
    console.error("getOtherFilesForAccount error:", e);
    return [];
  }
}

export function clearRemoteFilesForAccount(accountId: number) {
  if (!db) return;
  try {
    db.query("DELETE FROM remote_list_cache WHERE account_id = ?").run(accountId);
    db.query("DELETE FROM torrents WHERE account_id = ?").run(accountId);
  } catch (e) {
    console.error("clearRemoteFilesForAccount error:", e);
  }
}

/**
 * Delete all DB records associated with a specific torrent.
 * Runs in a single transaction for atomicity and performance.
 */
export function deleteRemoteFilesByTorrent(accountId: number, torrentId: number) {
  if (!db) return;
  try {
    const tx = db.transaction(() => {
      db.query("DELETE FROM file_thumbnails WHERE account_id = ? AND torrent_id = ?").run(accountId, torrentId);
      db.query("DELETE FROM user_watched WHERE account_id = ? AND torrent_id = ?").run(accountId, torrentId);
      db.query("DELETE FROM remote_list_cache WHERE account_id = ? AND torrent_id = ?").run(accountId, torrentId);
      db.query("DELETE FROM torrents WHERE account_id = ? AND torrent_id = ?").run(accountId, torrentId);
    });
    tx();
  } catch (e) {
    console.error("deleteRemoteFilesByTorrent error:", e);
  }
}

export function upsertTorrent(
  accountId: number,
  torrentId: number,
  torrentName: string | null,
  torrentHash: string | null,
  primaryMediaType: string,
  primaryTitle: string | null,
  tmdbId: number | null
) {
  if (!db) return;
  try {
    db.query(
      `
      INSERT INTO torrents (account_id, torrent_id, torrent_name, torrent_hash, primary_media_type, primary_title, tmdb_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, torrent_id) DO UPDATE SET
        torrent_name = excluded.torrent_name,
        torrent_hash = excluded.torrent_hash,
        primary_media_type = CASE
          WHEN torrents.primary_media_type = 'movie' THEN 'movie'
          WHEN torrents.primary_media_type = 'tv' AND excluded.primary_media_type != 'movie' THEN 'tv'
          ELSE excluded.primary_media_type
        END,
        primary_title = CASE
          WHEN torrents.primary_media_type = 'movie' THEN torrents.primary_title
          WHEN torrents.primary_media_type = 'tv' AND excluded.primary_media_type != 'movie' THEN torrents.primary_title
          ELSE excluded.primary_title
        END,
        tmdb_id = CASE
          WHEN torrents.primary_media_type = 'movie' THEN torrents.tmdb_id
          WHEN torrents.primary_media_type = 'tv' AND excluded.primary_media_type != 'movie' THEN torrents.tmdb_id
          ELSE excluded.tmdb_id
        END,
        synced_at = CURRENT_TIMESTAMP
    `
    ).run(accountId, torrentId, torrentName, torrentHash, primaryMediaType, primaryTitle, tmdbId);
  } catch (e) {
    console.error("upsertTorrent error:", e);
  }
}

export function getTorrentInfo(accountId: number, torrentId: number) {
  if (!db) return null;
  try {
    return db
      .query(
        `SELECT primary_title, primary_media_type, torrent_name
         FROM torrents
         WHERE account_id = ? AND torrent_id = ?`
      )
      .get(accountId, torrentId) as { primary_title: string | null; primary_media_type: string; torrent_name: string | null } | null;
  } catch (e) {
    console.error("getTorrentInfo error:", e);
    return null;
  }
}

/**
 * Get all distinct torrent IDs for a TV show (by show title match).
 * Used for batch deletion of an entire show's torrents.
 */
export function getTorrentIdsForTvShow(accountId: number, showTitle: string): number[] {
  if (!db) return [];
  try {
    const rows = db
      .query(
        `SELECT DISTINCT r.torrent_id
         FROM remote_list_cache r
         LEFT JOIN media m ON r.tmdb_id = m.tmdb_id
         WHERE r.account_id = ? AND r.media_type = 'tv'
           AND LOWER(COALESCE(m.title, r.show_title, r.raw_title)) = LOWER(?)`
      )
      .all(accountId, showTitle) as { torrent_id: number }[];
    return rows.map((r) => r.torrent_id);
  } catch (e) {
    console.error("getTorrentIdsForTvShow error:", e);
    return [];
  }
}

// ── User-level queries (merge all accounts) ────────────────────────────────────

export function getMoviesForUser(userId: number) {
  if (!db) return [];
  try {
    return db
      .query(
        `SELECT
           r.id,
           r.account_id,
           r.torrent_id,
           r.file_id,
           r.remote_path,
           r.filename,
           r.short_name,
           r.size,
           r.mime_type,
           r.tmdb_id,
           r.raw_title,
           r.raw_year,
           r.parsed_year,
           r.synced_at,
           m.title        AS media_title,
           m.year         AS media_year,
           m.poster_url   AS media_poster_url,
           m.backdrop_url AS media_backdrop_url,
           m.overview     AS media_overview,
           w.position_seconds,
           w.duration_seconds,
           w.completed,
           w.hidden
         FROM remote_list_cache r
         JOIN user_accounts ua ON r.account_id = ua.account_id
         LEFT JOIN media m ON r.tmdb_id = m.tmdb_id
         LEFT JOIN user_watched w ON w.user_id = ua.user_id AND w.account_id = r.account_id AND w.torrent_id = r.torrent_id AND w.file_id = r.file_id
         WHERE ua.user_id = ? AND r.media_type = 'movie'
         ORDER BY COALESCE(m.title, r.raw_title, r.filename) ASC`
      )
      .all(userId) as any[];
  } catch (e) {
    console.error("getMoviesForUser error:", e);
    return [];
  }
}

export function getTvShowsForUser(userId: number) {
  if (!db) return [];
  try {
    return db
      .query(
        `SELECT
           m.tmdb_id,
           m.title AS show_title,
           m.poster_url,
           m.backdrop_url,
           m.overview,
           COUNT(DISTINCT r.season_number) AS season_count,
           COUNT(r.id) AS episode_count,
           MIN(r.parsed_year) AS start_year
         FROM media m
         JOIN remote_list_cache r ON r.tmdb_id = m.tmdb_id
         JOIN user_accounts ua ON r.account_id = ua.account_id
         WHERE ua.user_id = ? AND r.media_type = 'tv'
         GROUP BY m.tmdb_id

         UNION ALL

         SELECT
           NULL AS tmdb_id,
           COALESCE(r.show_title, r.raw_title) AS show_title,
           NULL AS poster_url,
           NULL AS backdrop_url,
           NULL AS overview,
           COUNT(DISTINCT r.season_number) AS season_count,
           COUNT(r.id) AS episode_count,
           MIN(r.parsed_year) AS start_year
         FROM remote_list_cache r
         JOIN user_accounts ua ON r.account_id = ua.account_id
         WHERE ua.user_id = ? AND r.media_type = 'tv' AND r.tmdb_id IS NULL
         GROUP BY LOWER(COALESCE(r.show_title, r.raw_title))
         ORDER BY show_title COLLATE NOCASE ASC`
      )
      .all(userId, userId) as any[];
  } catch (e) {
    console.error("getTvShowsForUser error:", e);
    return [];
  }
}

export function getTvShowDetailsForUser(userId: number, showTitle: string) {
  if (!db) return null;
  try {
    const episodes = db
      .query(
        `SELECT
           r.id,
           r.account_id,
           r.torrent_id,
           r.file_id,
           r.remote_path,
           r.filename,
           r.short_name,
           r.size,
           r.mime_type,
           r.tmdb_id,
           r.show_title,
           r.season_number,
           r.episode_number,
           r.episode_end_number,
           r.parsed_year,
           r.synced_at,
           m.title        AS show_name,
           m.poster_url   AS show_poster_url,
           m.backdrop_url AS show_backdrop_url,
           m.overview     AS show_overview,
           e.episode_title,
           e.overview     AS episode_overview,
           e.still_url    AS episode_still_url,
           w.position_seconds,
           w.duration_seconds,
           w.completed,
           w.hidden,
           t.torrent_name
         FROM remote_list_cache r
         JOIN user_accounts ua ON r.account_id = ua.account_id
         LEFT JOIN media m ON r.tmdb_id = m.tmdb_id
         LEFT JOIN tv_episodes e ON (r.tmdb_id = e.show_tmdb_id AND r.season_number = e.season_number AND r.episode_number = e.episode_number)
         LEFT JOIN user_watched w ON w.user_id = ua.user_id AND w.account_id = r.account_id AND w.torrent_id = r.torrent_id AND w.file_id = r.file_id
         LEFT JOIN torrents t ON t.account_id = r.account_id AND t.torrent_id = r.torrent_id
         WHERE ua.user_id = ? AND r.media_type = 'tv' AND LOWER(COALESCE(m.title, r.show_title, r.raw_title)) = LOWER(?)
         ORDER BY r.season_number ASC, r.episode_number ASC`
      )
      .all(userId, showTitle) as any[];

    return episodes;
  } catch (e) {
    console.error("getTvShowDetailsForUser error:", e);
    return null;
  }
}

export function getOtherFilesForUser(userId: number) {
  if (!db) return [];
  try {
    return db
      .query(
        `SELECT
           r.id,
           r.account_id,
           r.torrent_id,
           r.file_id,
           r.remote_path,
           r.filename,
           r.short_name,
           r.size,
           r.mime_type,
           r.synced_at,
           w.position_seconds,
           w.duration_seconds,
           w.completed,
           w.hidden
         FROM remote_list_cache r
         JOIN user_accounts ua ON r.account_id = ua.account_id
         LEFT JOIN user_watched w ON w.user_id = ua.user_id AND w.account_id = r.account_id AND w.torrent_id = r.torrent_id AND w.file_id = r.file_id
         WHERE ua.user_id = ? AND (r.media_type = 'other' OR r.media_type IS NULL)
         ORDER BY r.filename ASC`
      )
      .all(userId) as any[];
  } catch (e) {
    console.error("getOtherFilesForUser error:", e);
    return [];
  }
}

export function deleteAccount(userId: number, accountId: number): boolean {
  if (!db) return false;
  try {
    const link = db.query("SELECT 1 FROM user_accounts WHERE user_id = ? AND account_id = ?").get(userId, accountId);
    if (!link) return false;

    db.query("DELETE FROM user_accounts WHERE user_id = ? AND account_id = ?").run(userId, accountId);

    const otherLinks = db.query("SELECT 1 FROM user_accounts WHERE account_id = ? LIMIT 1").get(accountId);
    if (!otherLinks) {
      db.query("DELETE FROM remote_list_cache WHERE account_id = ?").run(accountId);
      db.query("DELETE FROM accounts WHERE id = ?").run(accountId);
    }

    return true;
  } catch (e) {
    console.error("deleteAccount error:", e);
    return false;
  }
}

// user_watched (resume positions)

export function upsertWatchedPosition(
  userId: number,
  accountId: number,
  torrentId: number,
  fileId: number,
  position: number,
  duration: number | null,
  completed: boolean,
  hidden: boolean = false
) {
  if (!db) return;
  try {
    db.query(
      `INSERT INTO user_watched (user_id, account_id, torrent_id, file_id, position_seconds, duration_seconds, completed, hidden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, account_id, torrent_id, file_id) DO UPDATE SET
         position_seconds = excluded.position_seconds,
         duration_seconds = COALESCE(excluded.duration_seconds, user_watched.duration_seconds),
         completed        = excluded.completed,
         hidden           = excluded.hidden,
         last_updated     = CURRENT_TIMESTAMP`
    ).run(userId, accountId, torrentId, fileId, position, duration ?? null, completed ? 1 : 0, hidden ? 1 : 0);
  } catch (e) {
    console.error("upsertWatchedPosition error:", e);
  }
}

export function getWatchedPosition(userId: number, accountId: number, torrentId: number, fileId: number) {
  if (!db) return null;
  try {
    return db
      .query(
        "SELECT * FROM user_watched WHERE user_id=? AND account_id=? AND torrent_id=? AND file_id=?"
      )
      .get(userId, accountId, torrentId, fileId) as any;
  } catch (e) {
    console.error("getWatchedPosition error:", e);
    return null;
  }
}

export type NextEpisode = {
  account_id: number;
  torrent_id: number;
  file_id: number;
  season_number: number | null;
  episode_number: number | null;
  filename: string;
  episode_title?: string | null;
  show_title?: string | null;
};

// Resolve the episode that follows the given TV file (keyed off the current
// file itself, not a completed watch row). Algorithm mirrors findNext inside
// getContinueWatching. Returns null for movies, missing rows, or the last
// episode of a show.
export function findNextEpisodeForFile(
  userId: number,
  accountId: number,
  torrentId: number,
  fileId: number
): NextEpisode | null {
  if (!db) return null;
  try {
    const current = db
      .query(
        `SELECT account_id, torrent_id, file_id, tmdb_id, show_title, raw_title,
                media_type, season_number, episode_number, episode_end_number, filename
         FROM remote_list_cache
         WHERE account_id = ? AND torrent_id = ? AND file_id = ?`
      )
      .get(accountId, torrentId, fileId) as any;

    if (!current || current.media_type !== "tv" || current.episode_number == null) {
      return null;
    }

    const showKey = (row: any) =>
      row.tmdb_id != null
        ? `tmdb_${row.tmdb_id}`
        : `show_${String(row.show_title || row.raw_title || "").toLowerCase()}`;

    const currentKey = showKey(current);

    // Same TV-files query as getContinueWatching (files + user_watched hidden flag)
    const tvFiles = db
      .query(
        `SELECT r.account_id, r.torrent_id, r.file_id, r.tmdb_id, r.show_title, r.raw_title,
                r.media_type, r.season_number, r.episode_number, r.episode_end_number, r.filename,
                e.episode_title,
                w.hidden AS hidden
         FROM remote_list_cache r
         JOIN user_accounts ua ON ua.account_id = r.account_id
         LEFT JOIN tv_episodes e
           ON r.tmdb_id = e.show_tmdb_id AND r.season_number = e.season_number AND r.episode_number = e.episode_number
         LEFT JOIN user_watched w
           ON w.user_id = ? AND w.account_id = r.account_id AND w.torrent_id = r.torrent_id AND w.file_id = r.file_id
         WHERE ua.user_id = ? AND r.media_type = 'tv'`
      )
      .all(userId, userId) as any[];

    const files = tvFiles.filter((f) => showKey(f) === currentKey);

    const curSeason = current.season_number ?? 1;
    const nextEp = (current.episode_end_number ?? current.episode_number) + 1;

    // Candidate 1: same season, range covers nextEp (handles multi-episode files)
    let file = files.find(
      (f) =>
        (f.season_number ?? 1) === curSeason &&
        (f.episode_number ?? 0) <= nextEp &&
        (f.episode_end_number ?? f.episode_number ?? 0) >= nextEp &&
        !f.hidden
    );
    // Candidate 2: first non-hidden file of the next season
    if (!file) {
      file = files.find(
        (f) =>
          (f.season_number ?? 1) === curSeason + 1 &&
          (f.episode_number ?? 0) === 1 &&
          !f.hidden
      );
    }
    if (!file) return null;

    return {
      account_id: file.account_id,
      torrent_id: file.torrent_id,
      file_id: file.file_id,
      season_number: file.season_number ?? null,
      episode_number: file.episode_number ?? null,
      filename: file.filename,
      episode_title: file.episode_title ?? null,
      show_title: file.show_title ?? current.show_title ?? null,
    };
  } catch (e) {
    console.error("findNextEpisodeForFile error:", e);
    return null;
  }
}

export function getContinueWatching(userId: number, limit = 5) {
  if (!db) return [];
  try {
    // A. In-progress rows (all types) — resume cards
    const inProgress = db
      .query(
        `SELECT
           w.account_id,
           w.torrent_id,
           w.file_id,
           w.position_seconds,
           w.duration_seconds,
           w.last_updated,
           r.filename,
           r.media_type,
           r.show_title,
           r.raw_title,
           r.tmdb_id,
           r.season_number,
           r.episode_number,
           r.episode_end_number,
           r.remote_path,
           COALESCE(m.title, r.show_title, r.raw_title, r.filename) AS title,
           m.poster_url,
           COALESCE(e.still_url, m.backdrop_url, m.poster_url) AS backdrop_url,
           m.year,
           e.episode_title
         FROM user_watched w
         JOIN user_accounts ua ON ua.user_id = w.user_id AND ua.account_id = w.account_id
         LEFT JOIN remote_list_cache r
           ON r.account_id = w.account_id AND r.torrent_id = w.torrent_id AND r.file_id = w.file_id
         LEFT JOIN media m ON m.tmdb_id = r.tmdb_id
         LEFT JOIN tv_episodes e
           ON r.tmdb_id = e.show_tmdb_id
          AND r.season_number = e.season_number
          AND r.episode_number = e.episode_number
         WHERE w.user_id = ? AND w.completed = 0 AND w.position_seconds > 0 AND w.hidden = 0
         ORDER BY w.last_updated DESC`
      )
      .all(userId) as any[];

    // B. Completed TV rows (for up-next derivation)
    const completedTv = db
      .query(
        `SELECT
           w.account_id,
           w.torrent_id,
           w.file_id,
           w.position_seconds,
           w.duration_seconds,
           w.last_updated,
           r.filename,
           r.media_type,
           r.show_title,
           r.raw_title,
           r.tmdb_id,
           r.season_number,
           r.episode_number,
           r.episode_end_number,
           r.remote_path,
           COALESCE(m.title, r.show_title, r.raw_title, r.filename) AS title,
           m.poster_url,
           COALESCE(e.still_url, m.backdrop_url, m.poster_url) AS backdrop_url,
           m.year,
           e.episode_title
         FROM user_watched w
         JOIN user_accounts ua ON ua.user_id = w.user_id AND ua.account_id = w.account_id
         LEFT JOIN remote_list_cache r
           ON r.account_id = w.account_id AND r.torrent_id = w.torrent_id AND r.file_id = w.file_id
         LEFT JOIN media m ON m.tmdb_id = r.tmdb_id
         LEFT JOIN tv_episodes e
           ON r.tmdb_id = e.show_tmdb_id
          AND r.season_number = e.season_number
          AND r.episode_number = e.episode_number
         WHERE w.user_id = ? AND w.completed = 1 AND r.media_type = 'tv' AND w.hidden = 0
         ORDER BY w.last_updated DESC`
      )
      .all(userId) as any[];

    // C. All user TV files (next-episode resolution)
    const tvFiles = db
      .query(
        `SELECT r.account_id, r.torrent_id, r.file_id, r.tmdb_id, r.show_title, r.raw_title,
                r.media_type, r.season_number, r.episode_number, r.episode_end_number, r.filename,
                m.title AS media_title, m.poster_url, m.backdrop_url, m.year,
                e.episode_title, e.still_url,
                w.hidden as hidden
         FROM remote_list_cache r
         JOIN user_accounts ua ON ua.account_id = r.account_id
         LEFT JOIN media m ON m.tmdb_id = r.tmdb_id
         LEFT JOIN tv_episodes e
           ON r.tmdb_id = e.show_tmdb_id AND r.season_number = e.season_number AND r.episode_number = e.episode_number
         LEFT JOIN user_watched w 
           ON w.user_id = ? AND w.account_id = r.account_id AND w.torrent_id = r.torrent_id AND w.file_id = r.file_id
         WHERE ua.user_id = ? AND r.media_type = 'tv'`
      )
      .all(userId, userId) as any[];

    const showKey = (row: any) =>
      row.tmdb_id != null
        ? `tmdb_${row.tmdb_id}`
        : `show_${String(row.show_title || row.raw_title || "").toLowerCase()}`;

    // index C by show key
    const filesByShow = new Map<string, any[]>();
    for (const f of tvFiles) {
      const k = showKey(f);
      const arr = filesByShow.get(k);
      if (arr) arr.push(f);
      else filesByShow.set(k, [f]);
    }

    // find next-episode file for a completed row; returns { file, season, episode } | null
    const findNext = (completedRow: any) => {
      const files = filesByShow.get(showKey(completedRow)) || [];
      const curSeason = completedRow.season_number ?? 1;
      const curEnd = completedRow.episode_end_number ?? completedRow.episode_number ?? 0;
      const nextEp = curEnd + 1;
      let file = files.find(
        (f) =>
          (f.season_number ?? 1) === curSeason &&
          (f.episode_number ?? 0) <= nextEp &&
          (f.episode_end_number ?? f.episode_number ?? 0) >= nextEp &&
          !f.hidden
      );
      if (file) return { file, season: curSeason, episode: nextEp };
      file = files.find((f) => (f.season_number ?? 1) === curSeason + 1 && (f.episode_number ?? 0) === 1 && !f.hidden);
      return file ? { file, season: curSeason + 1, episode: 1 } : null;
    };

    // Up-next cards from most-recent completed row per show
    const completedByShow = new Map<string, any>();
    for (const row of completedTv) {
      const key = showKey(row);
      const existing = completedByShow.get(key);
      if (!existing || row.last_updated > existing.last_updated) {
        completedByShow.set(key, row);
      }
    }

    const cards = new Map<string, any>();

    const mergeCard = (key: string, card: any) => {
      const existing = cards.get(key);
      if (!existing || card.last_updated > existing.last_updated) {
        cards.set(key, card);
      }
    };

    // In-progress cards (all types)
    for (const row of inProgress) {
      const key =
        row.media_type === "tv"
          ? showKey(row)
          : `${row.account_id}-${row.torrent_id}-${row.file_id}`;

      if (row.media_type === "tv") {
        const latestCompleted = completedByShow.get(key);
        if (latestCompleted && latestCompleted.last_updated >= row.last_updated) {
          continue;
        }
      }

      mergeCard(key, {
        account_id: row.account_id,
        torrent_id: row.torrent_id,
        file_id: row.file_id,
        title: row.title || row.filename,
        filename: row.filename,
        media_type: row.media_type || "other",
        show_title: row.show_title,
        season_number: row.season_number,
        episode_number: row.episode_number,
        episode_title: row.episode_title,
        poster_url: row.poster_url,
        backdrop_url: row.backdrop_url,
        year: row.year,
        position_seconds: row.position_seconds,
        duration_seconds: row.duration_seconds,
        last_updated: row.last_updated,
        up_next: false,
      });
    }

    for (const [key, completedRow] of completedByShow) {
      const next = findNext(completedRow);
      if (!next) continue;
      const { file, season, episode } = next;
      mergeCard(key, {
        account_id: file.account_id,
        torrent_id: file.torrent_id,
        file_id: file.file_id,
        title: file.media_title || file.show_title || file.raw_title || file.filename,
        filename: file.filename,
        media_type: file.media_type || "tv",
        show_title: file.show_title,
        season_number: season,
        episode_number: episode,
        episode_title: file.episode_title,
        poster_url: file.poster_url,
        backdrop_url: file.still_url || file.backdrop_url || file.poster_url,
        year: file.year,
        position_seconds: 0,
        duration_seconds: null,
        last_updated: completedRow.last_updated,
        up_next: true,
      });
    }

    return Array.from(cards.values())
      .sort((a, b) => (a.last_updated < b.last_updated ? 1 : -1))
      .slice(0, limit);
  } catch (e) {
    console.error("getContinueWatching error:", e);
    return [];
  }
}

// ── legacy metadata_cache ──────────────────────────────────────────────────────

export function getMetadata(filename: string) {
  if (!db) return null;
  try {
    return db.query("SELECT * FROM metadata_cache WHERE filename = ?").get(filename) as any;
  } catch (error) {
    console.error("Failed to get metadata:", error);
    return null;
  }
}

export function setMetadata(filename: string, title: string, year: string, posterUrl: string) {
  if (!db) return;
  try {
    db.query(
      `INSERT OR REPLACE INTO metadata_cache (filename, title, year, poster_url, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(filename, title, year, posterUrl);
  } catch (error) {
    console.error("Failed to set metadata:", error);
  }
}

// ── file_thumbnails ──────────────────────────────────────────────────────────

export function getFilesNeedingThumbnails(accountId: number) {
  if (!db) return [];
  try {
    return db
      .query(
        `SELECT r.account_id, r.torrent_id, r.file_id, r.remote_path, r.filename
         FROM remote_list_cache r
         WHERE r.account_id = ? AND (r.media_type = 'other' OR r.media_type IS NULL)
         AND (
           SELECT COUNT(*) FROM file_thumbnails ft
           WHERE ft.account_id = r.account_id
             AND ft.torrent_id = r.torrent_id
             AND ft.file_id = r.file_id
         ) < 5
         ORDER BY r.filename ASC`
      )
      .all(accountId) as any[];
  } catch (e) {
    console.error("getFilesNeedingThumbnails error:", e);
    return [];
  }
}

export function getThumbnailCount(accountId: number, torrentId: number, fileId: number): number {
  if (!db) return 0;
  try {
    const row = db
      .query(
        `SELECT COUNT(*) as cnt FROM file_thumbnails
         WHERE account_id = ? AND torrent_id = ? AND file_id = ?`
      )
      .get(accountId, torrentId, fileId) as any;
    return row?.cnt ?? 0;
  } catch (e) {
    console.error("getThumbnailCount error:", e);
    return 0;
  }
}

export function insertThumbnail(accountId: number, torrentId: number, fileId: number, position: number) {
  if (!db) return;
  try {
    db.query(
      `INSERT OR IGNORE INTO file_thumbnails (account_id, torrent_id, file_id, position)
       VALUES (?, ?, ?, ?)`
    ).run(accountId, torrentId, fileId, position);
  } catch (e) {
    console.error("insertThumbnail error:", e);
  }
}

export function getThumbnailsForFile(accountId: number, torrentId: number, fileId: number) {
  if (!db) return [];
  try {
    return db
      .query(
        `SELECT position FROM file_thumbnails
         WHERE account_id = ? AND torrent_id = ? AND file_id = ?
         ORDER BY position ASC`
      )
      .all(accountId, torrentId, fileId) as any[];
  } catch (e) {
    console.error("getThumbnailsForFile error:", e);
    return [];
  }
}

export function deleteThumbnailsForAccount(accountId: number) {
  if (!db) return;
  try {
    db.query("DELETE FROM file_thumbnails WHERE account_id = ?").run(accountId);
  } catch (e) {
    console.error("deleteThumbnailsForAccount error:", e);
  }
}

export function deleteOrphanedThumbnails() {
  if (!db) return;
  try {
    db.query(
      `DELETE FROM file_thumbnails WHERE NOT EXISTS (
        SELECT 1 FROM remote_list_cache r
        WHERE r.account_id = file_thumbnails.account_id
          AND r.torrent_id = file_thumbnails.torrent_id
          AND r.file_id = file_thumbnails.file_id
      )`
    ).run();
  } catch (e) {
    console.error("deleteOrphanedThumbnails error:", e);
  }
}
