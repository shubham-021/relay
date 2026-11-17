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
  type PendingTorrentRecord,
  type PendingFileRecord,
} from "./db";
import { getValidAccessToken, fetchTorrentList } from "./torbox";
import { MIN_FILE_SIZE_BYTES, MIN_SAMPLE_FILE_SIZE_BYTES } from "./torbox-config";
import { VIDEO_EXTENSIONS, EXCLUDED_EXTENSIONS } from "./constants";
import { parseMediaFilename, type ParsedMedia } from "./parser";
import {
  searchTmdbMovie,
  searchTmdbTv,
  fetchSeasonEpisodes,
  normalizeTitle,
  isTitleMatch,
  getCachedAlternativeTitles,
  type TmdbSearchOutcome,
} from "./tmdb";

function isVideoFile(filename: string, mimetype?: string): boolean {
  // Prefer mimetype check if available
  if (mimetype && mimetype.startsWith("video/")) return true;
  // Fallback to extension check
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return VIDEO_EXTENSIONS.has(ext);
}

interface BuildOptions {
  skipSizeFilter?: boolean;
  signal?: AbortSignal;
  /** Per-call set of already-fetched (show, season) pairs — never module-level, it leaks. */
  fetchedSeasons?: Set<string>;
  /** Set to true by buildFileRecord when TMDB errored (vs a clean no-match). */
  onTmdbError?: () => void;
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

export interface SyncResult {
  success: boolean;
  filesSynced: number;
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
  options?: BuildOptions
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
      torrentName: null, // only available at torrent creation, not from TorBox's mylist API
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
  options?: BuildOptions
): Promise<boolean> {
  const record = await buildFileRecord(accountId, torrentId, torrentHash, file, options);
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

export async function syncAccount(accountId: number, signal?: AbortSignal): Promise<SyncResult> {
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

    // 3. Process each torrent/file through the shared pipeline WITHOUT touching the DB.
    //    (Old behavior cleared remote_list_cache up front — an abort or error mid-loop
    //    left a partially empty library. See LIB_FIX_PLAN.md Phase 4.)
    const fetchedSeasons = new Set<string>();
    const pendingTorrents = new Map<number, PendingTorrentRecord>();
    const pendingFiles: PendingFileRecord[] = [];
    let hadTmdbErrors = false;

    let filesSynced = 0;

    for (const torrent of torrents) {
      const torrentId = torrent.id;
      const torrentHash = torrent.hash || null;

      if (!torrent.files || !Array.isArray(torrent.files)) continue;

      for (const file of torrent.files) {
        const record = await buildFileRecord(
          accountId,
          torrentId,
          torrentHash,
          file,
          { signal, fetchedSeasons, onTmdbError: () => { hadTmdbErrors = true; } }
        );
        if (record) {
          filesSynced++;
          pendingTorrents.set(torrentId, record.torrent);
          pendingFiles.push(record.file);
        }
      }
    }

    // 4. Atomic swap: old rows deleted and new rows inserted in one transaction.
    replaceAccountFiles(
      accountId,
      [...pendingTorrents.values()],
      pendingFiles
    );

    updateAccountSyncTime(accountId);

    // If TMDB hiccups happened, bump last_updated_at so the UI can suggest a resync
    // for the files that were stored with tmdb_id NULL.
    if (hadTmdbErrors) {
      updateAccountUpdatedTime(accountId);
    }

    return { success: true, filesSynced };
  } catch (error) {
    console.error("Sync error:", error);
    return { success: false, filesSynced: 0, error: "Sync failed" };
  }
}
