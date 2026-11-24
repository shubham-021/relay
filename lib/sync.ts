/**
 * lib/sync.ts
 * Sync Engine (TorBox API):
 * 1. Get a valid access token (auto-refreshes if needed).
 * 2. Fetch all torrents + files via GET /v1/api/torrents/mylist.
 * 3. Filter files by minimum size threshold.
 * 4. Parse filename using lib/parser (detecting TV Show S01E01 / Movie / Other).
 * 5. Fetch rich metadata (posters, backdrops, episode titles, stills) from TMDB via lib/tmdb
 *    (ranked matching — see LIB_FIX_PLAN.md Phase 3).
 * 6. Commit records into remote_list_cache and torrents ATOMICALLY (Phase 4):
 *    all files are processed first, then swapped in inside a single transaction so an
 *    abort/crash mid-sync can never leave a half-cleared library.
 */

import {
  updateAccountSyncTime,
  updateAccountUpdatedTime,
  upsertMedia,
  upsertTvEpisode,
  upsertTorrent,
  upsertRemoteFile,
  replaceAccountFiles,
  getCachedTmdbResolution,
  getExistingRemoteFilesForAccount,
  getExistingTorrentsForAccount,
  applySyncDiff,
  type ExistingRemoteFile,
  type ExistingTorrent,
  type PendingTorrentRecord,
  type PendingFileRecord,
} from "./db";
import { getValidAccessToken, fetchTorrentList } from "./torbox";
import { MIN_FILE_SIZE_BYTES, MIN_SAMPLE_FILE_SIZE_BYTES } from "./torbox-config";
import { VIDEO_EXTENSIONS, EXCLUDED_EXTENSIONS } from "./constants";
import { parseMediaFilename, type ParsedMedia } from "./parser";
import { cleanupOrphanedThumbnailsFromDisk } from "./thumbnails";
import {
  searchTmdbMovie,
  searchTmdbTv,
  fetchSeasonEpisodes,
  normalizeTitle,
  isTitleMatch,
  getCachedAlternativeTitles,
  type TmdbSearchOutcome,
} from "./tmdb";

export function isVideoFile(filename: string, mimetype?: string): boolean {
  // Prefer mimetype check if available
  if (mimetype && mimetype.startsWith("video/")) return true;
  // Fallback to extension check
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return VIDEO_EXTENSIONS.has(ext);
}

export function isFileEligible(
  filename: string,
  size: number,
  mimetype?: string,
  skipSizeFilter = false
): boolean {
  if (!skipSizeFilter) {
    const lowerFilename = filename.toLowerCase();
    const isSample = lowerFilename.includes("sample");
    const minSize = isSample ? MIN_SAMPLE_FILE_SIZE_BYTES : MIN_FILE_SIZE_BYTES;
    if (size < minSize) return false;
  }

  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (EXCLUDED_EXTENSIONS.has(ext)) {
    return false;
  }

  if (!isVideoFile(filename, mimetype)) {
    return false;
  }

  return true;
}

export interface MetadataHints {
  name?: string;
  year?: string;
  category?: "movie" | "tv";
}

export interface BuildOptions {
  skipSizeFilter?: boolean;
  signal?: AbortSignal;
  /** Per-call set of already-fetched (show, season) pairs — never module-level, it leaks. */
  fetchedSeasons?: Set<string>;
  /** Set to true by buildFileRecord when TMDB errored (vs a clean no-match). */
  onTmdbError?: () => void;
  metadataHints?: MetadataHints;
}

/** Look up a previous resolution for this exact title/year/type before hitting the API. */
function lookupCachedResolution(
  parsed: ParsedMedia,
  mediaType: "movie" | "tv"
): number | null {
  const cached = getCachedTmdbResolution(parsed.title, parsed.year ?? null, mediaType, (mediaTitle, tmdbId) => {
    // Trust cache when stored media title matches parsed title (including variants, movie suffix, subtitles, or alternative titles)
    const alts = tmdbId ? getCachedAlternativeTitles(tmdbId, mediaType) : undefined;
    return isTitleMatch(parsed.title, mediaTitle ?? "", alts);
  });
  return cached?.tmdbId ?? null;
}

async function resolveMedia(
  parsed: ParsedMedia,
  options: BuildOptions
): Promise<
  | { kind: "matched"; tmdbId: number; mediaType: "movie" | "tv"; fromCache: true }
  | { kind: "matched"; tmdbId: number; mediaType: "movie" | "tv"; fromCache: false; match: { title: string; year: string; posterPath: string | null; backdropPath: string | null; overview: string | null } }
  | { kind: "unresolved"; mediaType: "movie" | "tv" | "other" }
> {
  // Sanity gate (Phase 2.4): junk filenames with no year and no SxxEyy marker never
  // reach TMDB — they'd waste quota and create garbage media rows.
  if (parsed.mediaType === "other") {
    return { kind: "unresolved", mediaType: "other" };
  }

  const mediaType: "movie" | "tv" = parsed.mediaType === "tv" ? "tv" : "movie";

  // Cache reuse (Phase 3.4): keep resyncs fast and stop results flapping between syncs.
  // The media row for this id already exists — skip the metadata write entirely so we
  // never overwrite the real TMDB title/poster with parsed placeholders.
  const cachedId = lookupCachedResolution(parsed, mediaType);
  if (cachedId) {
    return { kind: "matched", tmdbId: cachedId, mediaType, fromCache: true } as const;
  }

  let outcome: TmdbSearchOutcome;
  if (mediaType === "tv") {
    outcome = await searchTmdbTv(parsed.title, parsed.year, parsed.region, options.signal);
  } else {
    outcome = await searchTmdbMovie(parsed.title, parsed.year, parsed.region, options.signal);
  }

  if (outcome.status === "match") {
    const r = outcome.result;
    return {
      kind: "matched",
      tmdbId: r.id,
      mediaType,
      match: { title: r.title, year: r.year, posterPath: r.posterPath, backdropPath: r.backdropPath, overview: r.overview },
      fromCache: false,
    };
  }

  if (outcome.status === "error") {
    // API failure (rate limit, network, bad key). Do NOT demote the file to "other" —
    // keep the parser's classification with tmdb_id NULL so it stays in Movies/TV with
    // a placeholder instead of disappearing until the next successful resync.
    options.onTmdbError?.();
    return { kind: "unresolved", mediaType };
  }

  // Clean no-match: movie search found nothing → fall back to TV (mirrors old behavior
  // for e.g. limited-series releases named like movies); tv no-match stays tv/unresolved.
  if (mediaType === "movie") {
    const tvOutcome = await searchTmdbTv(parsed.title, parsed.year, parsed.region, options.signal);
    if (tvOutcome.status === "match") {
      const r = tvOutcome.result;
      return {
        kind: "matched",
        tmdbId: r.id,
        mediaType: "tv",
        fromCache: false,
        match: { title: r.title, year: r.year, posterPath: r.posterPath, backdropPath: r.backdropPath, overview: r.overview },
      };
    }
    if (tvOutcome.status === "error") options.onTmdbError?.();
    return { kind: "unresolved", mediaType: "movie" };
  }

  return { kind: "unresolved", mediaType: "tv" };
}

function applyMatchedMetadata(
  tmdbId: number,
  mediaType: "movie" | "tv",
  match: { title: string; year: string; posterPath: string | null; backdropPath: string | null; overview: string | null },
  parsed: ParsedMedia,
  options: BuildOptions
) {
  const posterUrl = match.posterPath ? `https://image.tmdb.org/t/p/w500${match.posterPath}` : "";
  const backdropUrl = match.backdropPath ? `https://image.tmdb.org/t/p/w1280${match.backdropPath}` : "";

  upsertMedia(tmdbId, match.title, match.year, posterUrl, mediaType, backdropUrl, match.overview);

  if (mediaType === "tv" && parsed.season !== undefined && parsed.season > 0) {
    void fetchAndSaveSeasonEpisodes(tmdbId, parsed.season, options);
  }
}

async function fetchAndSaveSeasonEpisodes(
  showTmdbId: number,
  seasonNumber: number,
  options: BuildOptions
) {
  const fetchedSeasons = options.fetchedSeasons;
  if (fetchedSeasons?.has(`${showTmdbId}-S${seasonNumber}`)) return;

  try {
    const episodes = await fetchSeasonEpisodes(showTmdbId, seasonNumber, options.signal);
    for (const ep of episodes) {
      upsertTvEpisode(showTmdbId, seasonNumber, ep.episodeNumber, ep.episodeTitle, ep.overview, ep.stillUrl);
    }
    if (episodes.length > 0) fetchedSeasons?.add(`${showTmdbId}-S${seasonNumber}`);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    console.error(`Failed to fetch season ${seasonNumber} for show ${showTmdbId}:`, e);
  }
}

export interface SyncOptions {
  forceFullSync?: boolean;
  signal?: AbortSignal;
}

export interface SyncResult {
  success: boolean;
  filesSynced: number;
  filesAdded?: number;
  filesModified?: number;
  filesDeleted?: number;
  error?: string;
}

/**
 * Standalone file-processing pipeline.
 * Parses the filename, looks up TMDB metadata, and returns a record ready to insert.
 *
 * Called by both:
 *  – syncAccount (full resync — records committed atomically at the end)
 *  – POST /api/torrent/create (inline insert after adding a torrent)
 *
 * Returns null if the file was skipped.
 */
export async function buildFileRecord(
  accountId: number,
  torrentId: number,
  torrentHash: string | null,
  file: {
    id: number;
    name: string;
    short_name?: string;
    size: number;
    mimetype?: string;
  },
  options?: BuildOptions,
  torrentName?: string | null
): Promise<{ torrent: PendingTorrentRecord; file: PendingFileRecord; tmdbErrored: boolean } | null> {
  const opts: BuildOptions = options ?? {};
  let tmdbErrored = false;

  const remotePath = file.name; // e.g. "Movie Folder/Movie.mkv"
  const filename = file.short_name || remotePath.split("/").pop() || remotePath;

  // Filter by minimum file size; files with "sample" in the name use a higher threshold (1 GB)
  if (!opts.skipSizeFilter) {
    const lowerFilename = filename.toLowerCase();
    const isSample = lowerFilename.includes("sample");
    const minSize = isSample ? MIN_SAMPLE_FILE_SIZE_BYTES : MIN_FILE_SIZE_BYTES;
    if (file.size < minSize) return null;
  }

  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (EXCLUDED_EXTENSIONS.has(ext)) {
    return null;
  }

  const shortName = file.short_name || null;
  const mimeType = file.mimetype || "application/octet-stream";

  if (!isVideoFile(filename, file.mimetype)) {
    // Non-video file — skip entirely, do not add to database
    return null;
  }

  // Parse filename using parser
  const parsed: ParsedMedia = parseMediaFilename(filename);

  // Apply user metadata hints if provided
  if (opts.metadataHints) {
    if (opts.metadataHints.name && opts.metadataHints.name.trim()) {
      parsed.title = opts.metadataHints.name.trim();
    }
    if (opts.metadataHints.year && opts.metadataHints.year.trim()) {
      parsed.year = opts.metadataHints.year.trim();
    }
    if (opts.metadataHints.category) {
      parsed.mediaType = opts.metadataHints.category;
    }
  }

  const resolved = await resolveMedia(parsed, {
    ...opts,
    onTmdbError: () => {
      tmdbErrored = true;
      opts.onTmdbError?.();
    },
  });

  let mediaType: "movie" | "tv" | "other";
  let tmdbId: number | null = null;
  let showTitle: string | null = null;

  if (resolved.kind === "matched") {
    mediaType = resolved.mediaType;
    tmdbId = resolved.tmdbId;
    if (mediaType === "tv") showTitle = parsed.title;
    if (!resolved.fromCache) {
      applyMatchedMetadata(resolved.tmdbId, resolved.mediaType, resolved.match, parsed, opts);
    }
  } else {
    mediaType = resolved.mediaType;
    if (mediaType === "tv") showTitle = parsed.title;
  }

  const epStart = parsed.episodes && parsed.episodes.length > 0 ? parsed.episodes[0] : null;
  const epEnd = parsed.episodes && parsed.episodes.length > 1 ? parsed.episodes[parsed.episodes.length - 1] : null;

  return {
    tmdbErrored,
    torrent: {
      torrentId,
      torrentName: torrentName || null,
      torrentHash,
      primaryMediaType: mediaType,
      primaryTitle: parsed.title,
      tmdbId,
    },
    file: {
      torrentId,
      fileId: file.id,
      remotePath,
      filename,
      shortName,
      size: file.size,
      mimeType,
      torrentHash,
      tmdbId,
      rawTitle: parsed.title,
      rawYear: parsed.year || null,
      mediaType,
      showTitle,
      seasonNumber: parsed.season ?? null,
      episodeNumber: epStart,
      episodeEndNumber: epEnd,
      parsedYear: parsed.year || null,
    },
  };
}

/**
 * Inline insert path used by POST /api/torrent/create.
 * Builds the record and upserts immediately (single torrent, no clear phase involved).
 */
export async function processAndInsertFile(
  accountId: number,
  torrentId: number,
  torrentHash: string | null,
  file: {
    id: number;
    name: string;
    short_name?: string;
    size: number;
    mimetype?: string;
  },
  options?: BuildOptions,
  torrentName?: string | null
): Promise<boolean> {
  const record = await buildFileRecord(accountId, torrentId, torrentHash, file, options, torrentName);
  if (!record) return false;

  upsertTorrent(
    accountId,
    record.torrent.torrentId,
    record.torrent.torrentName,
    record.torrent.torrentHash,
    record.torrent.primaryMediaType,
    record.torrent.primaryTitle,
    record.torrent.tmdbId
  );
  upsertRemoteFile(
    accountId,
    record.file.torrentId,
    record.file.fileId,
    record.file.remotePath,
    record.file.filename,
    record.file.shortName,
    record.file.size,
    record.file.mimeType,
    record.file.torrentHash,
    record.file.tmdbId,
    record.file.rawTitle,
    record.file.rawYear,
    record.file.mediaType,
    record.file.showTitle,
    record.file.seasonNumber,
    record.file.episodeNumber,
    record.file.episodeEndNumber,
    record.file.parsedYear
  );

  return true;
}

export async function syncAccount(
  accountId: number,
  options?: AbortSignal | SyncOptions
): Promise<SyncResult> {
  const opts: SyncOptions =
    options instanceof AbortSignal ? { signal: options } : (options ?? {});
  const signal = opts.signal;
  const forceFullSync = opts.forceFullSync === true;

  try {
    // 1. Get a valid access token (auto-refreshes if expired)
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(accountId, signal);
    } catch (e: any) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      return { success: false, filesSynced: 0, error: e.message || "Failed to authenticate" };
    }

    // 2. Fetch torrent list from TorBox API
    let torrents;
    try {
      torrents = await fetchTorrentList(accessToken, signal);
    } catch (e: any) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (e.status === 429) {
        return { success: false, filesSynced: 0, error: "TorBox rate limit exceeded" };
      }
      return { success: false, filesSynced: 0, error: e.message || "Failed to fetch torrent list" };
    }

    // 3. Query existing state from local DB for this account
    const existingFiles = getExistingRemoteFilesForAccount(accountId);
    const existingTorrents = getExistingTorrentsForAccount(accountId);

    const existingFilesMap = new Map<string, ExistingRemoteFile>();
    for (const f of existingFiles) {
      existingFilesMap.set(`${f.torrent_id}:${f.file_id}`, f);
    }

    const existingTorrentsMap = new Map<number, ExistingTorrent>();
    for (const t of existingTorrents) {
      existingTorrentsMap.set(t.torrent_id, t);
    }

    const activeFileKeys = new Set<string>();
    const incomingTorrentsMap = new Map<number, (typeof torrents)[0]>();

    const fetchedSeasons = new Set<string>();
    const pendingTorrents = new Map<number, PendingTorrentRecord>();
    const pendingFiles: PendingFileRecord[] = [];
    let hadTmdbErrors = false;

    let filesAdded = 0;
    let filesModified = 0;
    let unchangedFilesCount = 0;

    // Process incoming torrents and files
    for (const torrent of torrents) {
      const torrentId = torrent.id;
      const torrentHash = torrent.hash || null;
      const torrentName = torrent.name || null;
      incomingTorrentsMap.set(torrentId, torrent);

      if (!torrent.files || !Array.isArray(torrent.files)) continue;

      for (const file of torrent.files) {
        const remotePath = file.name;
        const filename = file.short_name || remotePath.split("/").pop() || remotePath;

        // Check file eligibility before doing any expensive parsing or network calls
        if (!isFileEligible(filename, file.size, file.mimetype)) {
          continue;
        }

        const fileKey = `${torrentId}:${file.id}`;
        activeFileKeys.add(fileKey);

        const existing = existingFilesMap.get(fileKey);

        if (existing && !forceFullSync) {
          // Check if file is unchanged
          const isUnchanged =
            existing.remote_path === remotePath &&
            existing.filename === filename &&
            (existing.short_name ?? null) === (file.short_name || null) &&
            existing.size === file.size &&
            (existing.mime_type ?? "application/octet-stream") === (file.mimetype || "application/octet-stream") &&
            (existing.torrent_hash ?? null) === torrentHash;

          // Edge case: previously unmatched TV show with tmdb_id IS NULL should be retried automatically
          const needsTvRetry = isUnchanged && existing.media_type === "tv" && existing.tmdb_id === null;

          if (isUnchanged && !needsTvRetry) {
            unchangedFilesCount++;
            // Preserve the torrent row while ensuring torrent_name is updated if previously null
            const existingTorrent = existingTorrentsMap.get(torrentId);
            if (!existingTorrent?.torrent_name && torrentName) {
              if (!pendingTorrents.has(torrentId)) {
                pendingTorrents.set(torrentId, {
                  torrentId,
                  torrentName,
                  torrentHash,
                  primaryMediaType: existing.media_type,
                  primaryTitle: existing.show_title || existing.raw_title,
                  tmdbId: existing.tmdb_id,
                });
              }
            }
            continue;
          }

          if (isUnchanged && needsTvRetry) {
            // TV retry - re-process with TMDB below
          } else {
            filesModified++;
          }
        } else {
          filesAdded++;
        }

        // Process new, modified, retried, or force-full-synced file
        const record = await buildFileRecord(
          accountId,
          torrentId,
          torrentHash,
          file,
          { signal, fetchedSeasons, onTmdbError: () => { hadTmdbErrors = true; } },
          torrentName
        );

        if (record) {
          pendingTorrents.set(torrentId, record.torrent);
          pendingFiles.push(record.file);
        }
      }
    }

    // 4. Determine deletions
    const filesToDelete: Array<{ torrentId: number; fileId: number }> = [];
    for (const [key, existing] of existingFilesMap) {
      if (!activeFileKeys.has(key)) {
        // If the torrent is present in TorBox but has no files array (e.g. downloading/metadata-pending),
        // do NOT treat existing files as deleted!
        const incomingTorrent = incomingTorrentsMap.get(existing.torrent_id);
        const isDownloadingOrEmpty =
          incomingTorrent && (!incomingTorrent.files || !Array.isArray(incomingTorrent.files) || incomingTorrent.files.length === 0);

        if (!isDownloadingOrEmpty) {
          filesToDelete.push({ torrentId: existing.torrent_id, fileId: existing.file_id });
        }
      }
    }

    // Determine torrents to delete:
    // Torrents completely removed from TorBox OR torrents with no remaining eligible files
    const torrentsToDelete: number[] = [];
    for (const [torrentId] of existingTorrentsMap) {
      if (!incomingTorrentsMap.has(torrentId)) {
        torrentsToDelete.push(torrentId);
      } else {
        const incomingTorrent = incomingTorrentsMap.get(torrentId);
        const isDownloadingOrEmpty =
          incomingTorrent && (!incomingTorrent.files || !Array.isArray(incomingTorrent.files) || incomingTorrent.files.length === 0);

        const hasRemainingFiles =
          Array.from(existingFilesMap.values()).some(
            (f) =>
              f.torrent_id === torrentId &&
              !filesToDelete.some((d) => d.torrentId === f.torrent_id && d.fileId === f.file_id)
          ) || pendingFiles.some((f) => f.torrentId === torrentId);

        if (!hasRemainingFiles && !isDownloadingOrEmpty) {
          torrentsToDelete.push(torrentId);
        }
      }
    }

    // 5. Apply diff atomically in SQLite
    applySyncDiff({
      accountId,
      torrentsToUpsert: [...pendingTorrents.values()],
      filesToUpsert: pendingFiles,
      filesToDelete,
      torrentsToDelete,
    });

    // 6. Update sync time (always updated on completed sync run)
    updateAccountSyncTime(accountId);

    const hasChanges =
      pendingFiles.length > 0 ||
      filesToDelete.length > 0 ||
      torrentsToDelete.length > 0 ||
      hadTmdbErrors;

    if (hasChanges) {
      updateAccountUpdatedTime(accountId);
      await cleanupOrphanedThumbnailsFromDisk();
    }

    const totalFilesSynced = unchangedFilesCount + pendingFiles.length;

    return {
      success: true,
      filesSynced: totalFilesSynced,
      filesAdded,
      filesModified,
      filesDeleted: filesToDelete.length,
    };
  } catch (error) {
    console.error("Sync error:", error);
    return { success: false, filesSynced: 0, error: "Sync failed" };
  }
}
