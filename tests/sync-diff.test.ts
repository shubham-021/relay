import { describe, it, expect, beforeEach } from "bun:test";
import {
  getDb,
  applySyncDiff,
  getExistingRemoteFilesForAccount,
  getExistingTorrentsForAccount,
  upsertRemoteFile,
  upsertTorrent,
  upsertMedia,
  updateFileMetadata,
  updateAccountSyncTime,
  updateAccountUpdatedTime,
} from "../lib/db";
import { isFileEligible } from "../lib/sync";
import { acquireLock, releaseLock, isLocked, isAccountSyncing } from "../lib/in-flight";

describe("Sync Engine Diff & Metadata Preservation Suite", () => {
  const testAccountId = 9999;
  const db = getDb();

  beforeEach(() => {
    if (!db) return;
    // Clean up test account artifacts
    db.query("DELETE FROM remote_list_cache WHERE account_id = ?").run(testAccountId);
    db.query("DELETE FROM torrents WHERE account_id = ?").run(testAccountId);
    db.query("DELETE FROM user_watched WHERE account_id = ?").run(testAccountId);
    db.query("DELETE FROM file_thumbnails WHERE account_id = ?").run(testAccountId);
    db.query("DELETE FROM user_accounts WHERE account_id = ?").run(testAccountId);
    db.query("DELETE FROM accounts WHERE id = ?").run(testAccountId);

    // Create test account
    db.query(
      `INSERT INTO accounts (id, torbox_email, torbox_password, created_at, last_updated_at)
       VALUES (?, 'sync-diff-test@example.com', 'encrypted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(testAccountId);

    db.query(
      `INSERT INTO user_accounts (user_id, account_id, is_active)
       VALUES (1, ?, 1)`
    ).run(testAccountId);
  });

  describe("isFileEligible unit tests", () => {
    it("accepts valid video files above minimum size", () => {
      expect(isFileEligible("Inception.2010.1080p.mkv", 600 * 1024 * 1024)).toBe(true);
      expect(isFileEligible("Show.S01E01.mp4", 550 * 1024 * 1024)).toBe(true);
    });

    it("rejects non-video files or excluded extensions", () => {
      expect(isFileEligible("movie.sub", 600 * 1024 * 1024)).toBe(false);
      expect(isFileEligible("movie.nfo", 1024)).toBe(false);
      expect(isFileEligible("movie.txt", 1024)).toBe(false);
      expect(isFileEligible("movie.exe", 600 * 1024 * 1024)).toBe(false);
    });

    it("rejects files under the minimum size threshold (unless sample threshold applies)", () => {
      // 300 MB is below the 500 MB threshold
      expect(isFileEligible("ShortClip.mp4", 300 * 1024 * 1024)).toBe(false);
      // Sample file under 1 GB is rejected
      expect(isFileEligible("Inception.Sample.mkv", 600 * 1024 * 1024)).toBe(false);
      // Sample file above 1 GB is accepted
      expect(isFileEligible("Inception.Sample.mkv", 1.2 * 1024 * 1024 * 1024)).toBe(true);
    });
  });

  describe("applySyncDiff database operations", () => {
    it("inserts new files and torrents properly", () => {
      applySyncDiff({
        accountId: testAccountId,
        torrentsToUpsert: [
          {
            torrentId: 101,
            torrentName: "Inception 2010",
            torrentHash: "hash101",
            primaryMediaType: "movie",
            primaryTitle: "Inception",
            tmdbId: 27205,
          },
        ],
        filesToUpsert: [
          {
            torrentId: 101,
            fileId: 1,
            remotePath: "Inception.mkv",
            filename: "Inception.mkv",
            shortName: "Inception.mkv",
            size: 2 * 1024 * 1024 * 1024,
            mimeType: "video/x-matroska",
            torrentHash: "hash101",
            tmdbId: 27205,
            rawTitle: "Inception",
            rawYear: "2010",
            mediaType: "movie",
            showTitle: null,
            seasonNumber: null,
            episodeNumber: null,
            episodeEndNumber: null,
            parsedYear: "2010",
          },
        ],
        filesToDelete: [],
        torrentsToDelete: [],
      });

      const files = getExistingRemoteFilesForAccount(testAccountId);
      expect(files.length).toBe(1);
      expect(files[0].torrent_id).toBe(101);
      expect(files[0].file_id).toBe(1);
      expect(files[0].tmdb_id).toBe(27205);

      const torrents = getExistingTorrentsForAccount(testAccountId);
      expect(torrents.length).toBe(1);
      expect(torrents[0].torrent_id).toBe(101);
      expect(torrents[0].torrent_name).toBe("Inception 2010");
    });

    it("preserves manual metadata edit when unchanged during diff", () => {
      // 1. Initial file insert
      upsertTorrent(testAccountId, 202, "Unknown Torrent", "hash202", "movie", "Unknown", null);
      upsertRemoteFile(
        testAccountId,
        202,
        1,
        "Unknown.Release.mkv",
        "Unknown.Release.mkv",
        null,
        1024 * 1024 * 1024,
        "video/x-matroska",
        "hash202",
        null, // initially unmatched
        "Unknown",
        null,
        "movie"
      );

      // 2. User manually edits metadata to Interstellar (TMDB ID 157336)
      upsertMedia(157336, "Interstellar", "2014", "poster.jpg", "movie", "backdrop.jpg", "A team of explorers...");
      updateFileMetadata(testAccountId, 202, 1, 157336, "movie", "Interstellar");

      // Verify the manual edit took effect
      let files = getExistingRemoteFilesForAccount(testAccountId);
      expect(files[0].tmdb_id).toBe(157336);

      // 3. Diff sync runs where this file is unchanged (nothing in filesToUpsert or filesToDelete)
      applySyncDiff({
        accountId: testAccountId,
        torrentsToUpsert: [],
        filesToUpsert: [],
        filesToDelete: [],
        torrentsToDelete: [],
      });

      // 4. Verify manual metadata is 100% preserved!
      files = getExistingRemoteFilesForAccount(testAccountId);
      expect(files.length).toBe(1);
      expect(files[0].tmdb_id).toBe(157336);

      const torrents = getExistingTorrentsForAccount(testAccountId);
      expect(torrents[0].tmdb_id).toBe(157336);
      expect(torrents[0].primary_title).toBe("Interstellar");
    });

    it("deletes removed files and cascades cleanup to user_watched and file_thumbnails", () => {
      // Insert file, watched progress, and thumbnail
      upsertTorrent(testAccountId, 303, "Torrent To Delete", "hash303", "movie", "Title", 123);
      upsertRemoteFile(
        testAccountId,
        303,
        1,
        "File1.mkv",
        "File1.mkv",
        null,
        1024 * 1024 * 1024,
        "video/x-matroska",
        "hash303",
        123,
        "Title",
        "2020",
        "movie"
      );

      if (db) {
        db.query(
          `INSERT INTO user_watched (user_id, account_id, torrent_id, file_id, position_seconds, duration_seconds)
           VALUES (1, ?, 303, 1, 120, 3600)`
        ).run(testAccountId);

        db.query(
          `INSERT INTO file_thumbnails (account_id, torrent_id, file_id, position)
           VALUES (?, 303, 1, 1)`
        ).run(testAccountId);
      }

      // Delete via applySyncDiff
      applySyncDiff({
        accountId: testAccountId,
        torrentsToUpsert: [],
        filesToUpsert: [],
        filesToDelete: [{ torrentId: 303, fileId: 1 }],
        torrentsToDelete: [303],
      });

      const files = getExistingRemoteFilesForAccount(testAccountId);
      expect(files.length).toBe(0);

      const torrents = getExistingTorrentsForAccount(testAccountId);
      expect(torrents.length).toBe(0);

      const watched = db?.query("SELECT * FROM user_watched WHERE account_id = ?").all(testAccountId);
      expect(watched?.length).toBe(0);

      const thumbs = db?.query("SELECT * FROM file_thumbnails WHERE account_id = ?").all(testAccountId);
      expect(thumbs?.length).toBe(0);
    });

    it("updates last_synced_at without changing last_updated_at on no-op sync", async () => {
      // Set initial timestamps
      updateAccountSyncTime(testAccountId);
      updateAccountUpdatedTime(testAccountId);

      const rowBefore = db?.query("SELECT last_synced_at, last_updated_at FROM accounts WHERE id = ?").get(testAccountId) as any;
      const initialUpdated = rowBefore.last_updated_at;

      // Small delay to ensure timestamp difference if it were modified
      await new Promise((r) => setTimeout(r, 20));

      // No-op sync: only update sync time
      updateAccountSyncTime(testAccountId);

      const rowAfter = db?.query("SELECT last_synced_at, last_updated_at FROM accounts WHERE id = ?").get(testAccountId) as any;

      // last_synced_at should be >= before
      expect(rowAfter.last_synced_at).toBeDefined();
      // last_updated_at MUST NOT have changed!
      expect(rowAfter.last_updated_at).toBe(initialUpdated);
    });
  });

  describe("In-Flight Sync Locking & Concurrency Protection Suite", () => {
    const accountLockKey = `account:${testAccountId}:sync`;
    const userLockKey = "user:42:sync";

    it("prevents concurrent syncs on the same account across different users", () => {
      // User A acquires lock for testAccountId
      const userAController = acquireLock(accountLockKey);
      expect(userAController).not.toBeNull();
      expect(isAccountSyncing(testAccountId)).toBe(true);

      // User B attempts to acquire lock for the same account
      const userBController = acquireLock(accountLockKey);
      expect(userBController).toBeNull(); // Blocked!

      // User A finishes and releases lock
      releaseLock(accountLockKey, userAController!);
      expect(isAccountSyncing(testAccountId)).toBe(false);

      // Now User B can acquire the lock
      const userBControllerRetry = acquireLock(accountLockKey);
      expect(userBControllerRetry).not.toBeNull();
      releaseLock(accountLockKey, userBControllerRetry!);
    });

    it("prevents the same user from running multiple heavy syncs concurrently", () => {
      // User initiates sync on Account 1
      const sync1Controller = acquireLock(userLockKey);
      expect(sync1Controller).not.toBeNull();

      // Same user attempts heavy sync on Account 2
      const sync2Controller = acquireLock(userLockKey);
      expect(sync2Controller).toBeNull(); // Blocked by user-level lock!

      releaseLock(userLockKey, sync1Controller!);
    });

    it("auto-expires stuck lock after timeout and aborts signal", async () => {
      const timeoutKey = "test:timeout:key";
      // Acquire lock with short timeout of 50ms (simulating the 5-min timeout)
      const controller = acquireLock(timeoutKey, 50);
      expect(controller).not.toBeNull();
      expect(isLocked(timeoutKey)).toBe(true);
      expect(controller?.signal.aborted).toBe(false);

      // Wait for timeout to fire
      await new Promise((r) => setTimeout(r, 80));

      // Lock should have automatically expired and aborted
      expect(isLocked(timeoutKey)).toBe(false);
      expect(controller?.signal.aborted).toBe(true);
    });
  });
});
