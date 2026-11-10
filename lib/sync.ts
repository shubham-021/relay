/**
 * lib/sync.ts
 * Sync Engine (TorBox API):
 * 1. Get a valid access token (auto-refreshes if needed).
 * 2. Fetch all torrents + files via GET /v1/api/torrents/mylist.
 * 3. Filter files by minimum size threshold.
 * 4. Parse filename using lib/parser (detecting TV Show S01E01 / Movie / Other).
 * 5. Fetch rich metadata (posters, backdrops, episode titles, stills) from TMDB.
 * 6. Save structured records into remote_list_cache, media, and tv_episodes tables.
 */

import {
  updateAccountSyncTime,
  updateAccountUpdatedTime,
  clearRemoteFilesForAccount,
  upsertRemoteFile,
  upsertMedia,
  upsertTvEpisode,
  upsertTorrent,
} from "./db";
import { getValidAccessToken, fetchTorrentList } from "./torbox";
import { MIN_FILE_SIZE_BYTES, MIN_SAMPLE_FILE_SIZE_BYTES } from "./torbox-config";
import { VIDEO_EXTENSIONS, EXCLUDED_EXTENSIONS } from "./constants";
import { parseMediaFilename, type ParsedMedia } from "./parser";

const TMDB_API_KEY = process.env.TMDB_API_KEY;

function isVideoFile(filename: string, mimetype?: string): boolean {
  // Prefer mimetype check if available
  if (mimetype && mimetype.startsWith("video/")) return true;
  // Fallback to extension check
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return VIDEO_EXTENSIONS.has(ext);
}

// In-memory set to avoid re-fetching season details multiple times in a single sync
const fetchedSeasonKeys = new Set<string>();

async function searchTmdbMovie(title: string, year?: string, signal?: AbortSignal) {
  if (!TMDB_API_KEY) return null;

  const fetchMovie = async (searchYear?: string) => {
    let url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
    if (searchYear) url += `&primary_release_year=${searchYear}`;
    const res = await fetch(url, { signal });
    const data = await res.json();
    return data.results?.[0] || null;
  };

  try {
    let result = await fetchMovie(year);
    if (result) return result;

    // Retry with -1 and +1 year concurrently if exact year failed
    if (year) {
      const yearNum = parseInt(year, 10);
      if (!isNaN(yearNum)) {
        const [prev, next] = await Promise.all([
          fetchMovie(String(yearNum - 1)),
          fetchMovie(String(yearNum + 1))
        ]);
        if (prev) return prev;
        if (next) return next;
      }
    }

    // Final fallback without year restriction
    if (year) return await fetchMovie();

    return null;
  } catch (e) {
    console.error("TMDB movie search error:", e);
    return null;
  }
}

async function searchTmdbTv(title: string, year?: string, signal?: AbortSignal) {
  if (!TMDB_API_KEY) return null;

  const fetchTv = async (searchYear?: string) => {
    let url = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
    if (searchYear) url += `&first_air_date_year=${searchYear}`;
    const res = await fetch(url, { signal });
    const data = await res.json();
    return data.results?.[0] || null;
  };

  try {
    let result = await fetchTv(year);
    if (result) return result;

    // Retry with -1 and +1 year concurrently if exact year failed
    if (year) {
      const yearNum = parseInt(year, 10);
      if (!isNaN(yearNum)) {
        const [prev, next] = await Promise.all([
          fetchTv(String(yearNum - 1)),
          fetchTv(String(yearNum + 1))
        ]);
        if (prev) return prev;
        if (next) return next;
      }
    }

    // Final fallback without year restriction
    if (year) return await fetchTv();

    return null;
  } catch (e) {
    console.error("TMDB TV search error:", e);
    return null;
  }
}

async function fetchAndSaveSeasonEpisodes(showTmdbId: number, seasonNumber: number, signal?: AbortSignal) {
  if (!TMDB_API_KEY || seasonNumber <= 0) return;
  const key = `${showTmdbId}-S${seasonNumber}`;
  if (fetchedSeasonKeys.has(key)) return;

  try {
    const url = `https://api.themoviedb.org/3/tv/${showTmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return;
    const data = await res.json();

    if (data && Array.isArray(data.episodes)) {
      for (const ep of data.episodes) {
        const episodeNumber = ep.episode_number;
        const episodeTitle = ep.name || `Episode ${episodeNumber}`;
        const overview = ep.overview || null;
        const stillUrl = ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null;

        upsertTvEpisode(showTmdbId, seasonNumber, episodeNumber, episodeTitle, overview, stillUrl);
      }
      fetchedSeasonKeys.add(key);
    }
  } catch (e) {
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
 * Parses the filename, looks up TMDB metadata, and upserts into
 * remote_list_cache (+ media / tv_episodes when matched).
 *
 * Called by both:
 *  – syncAccount (full resync)
 *  – POST /api/torrent/create (inline insert after adding a torrent)
 *
 * Returns true if the file was inserted, false if skipped.
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
  options?: { skipSizeFilter?: boolean; signal?: AbortSignal }
): Promise<boolean> {
  const { skipSizeFilter = false } = options || {};

  const remotePath = file.name; // e.g. "Movie Folder/Movie.mkv"
  const filename = file.short_name || remotePath.split("/").pop() || remotePath;

  // Filter by minimum file size; files with "sample" in the name use a higher threshold (1 GB)
  if (!skipSizeFilter) {
    const lowerFilename = filename.toLowerCase();
    const isSample = lowerFilename.includes("sample");
    const minSize = isSample ? MIN_SAMPLE_FILE_SIZE_BYTES : MIN_FILE_SIZE_BYTES;
    if (file.size < minSize) return false;
  }

  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (EXCLUDED_EXTENSIONS.has(ext)) {
    return false;
  }

  const shortName = file.short_name || null;
  const mimeType = file.mimetype || "application/octet-stream";

  if (!isVideoFile(filename, file.mimetype)) {
    // Non-video file — skip entirely, do not add to database
    return false;
  }

  // Parse filename using parser
  const parsed: ParsedMedia = parseMediaFilename(filename);

  let tmdbId: number | null = null;
  let mediaType: "movie" | "tv" | "other" = "other";

  if (parsed.mediaType === "tv") {
    const tvResult = await searchTmdbTv(parsed.title, parsed.year, options?.signal);
    if (tvResult) {
      const showTmdbId = tvResult.id as number;
      tmdbId = showTmdbId;
      const showTitle = tvResult.name || parsed.title;
      const posterUrl = tvResult.poster_path ? `https://image.tmdb.org/t/p/w500${tvResult.poster_path}` : "";
      const backdropUrl = tvResult.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tvResult.backdrop_path}` : "";
      const firstAir = tvResult.first_air_date ? tvResult.first_air_date.split("-")[0] : parsed.year || "";

      upsertMedia(showTmdbId, showTitle, firstAir, posterUrl, "tv", backdropUrl, tvResult.overview);

      if (parsed.season !== undefined && parsed.season > 0) {
        await fetchAndSaveSeasonEpisodes(showTmdbId, parsed.season, options?.signal);
      }
      mediaType = "tv";
    } else {
      // SxxEyy present but not matched on TMDB — still classify as 'tv'
      mediaType = "tv";
    }
  } else {
    // Try TMDB Movie first
    const movieResult = await searchTmdbMovie(parsed.title, parsed.year, options?.signal);
    if (movieResult) {
      const movieTmdbId = movieResult.id as number;
      tmdbId = movieTmdbId;
      const movieTitle = movieResult.title || parsed.title;
      const posterUrl = movieResult.poster_path ? `https://image.tmdb.org/t/p/w500${movieResult.poster_path}` : "";
      const backdropUrl = movieResult.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movieResult.backdrop_path}` : "";
      const releaseYear = movieResult.release_date ? movieResult.release_date.split("-")[0] : parsed.year || "";

      upsertMedia(movieTmdbId, movieTitle, releaseYear, posterUrl, "movie", backdropUrl, movieResult.overview);
      mediaType = "movie";
    } else {
      // Try TMDB TV as fallback
      const tvResult = await searchTmdbTv(parsed.title, parsed.year, options?.signal);
      if (tvResult) {
        const showTmdbId = tvResult.id as number;
        tmdbId = showTmdbId;
        const showTitle = tvResult.name || parsed.title;
        const posterUrl = tvResult.poster_path ? `https://image.tmdb.org/t/p/w500${tvResult.poster_path}` : "";
        const backdropUrl = tvResult.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tvResult.backdrop_path}` : "";
        const firstAir = tvResult.first_air_date ? tvResult.first_air_date.split("-")[0] : parsed.year || "";

        upsertMedia(showTmdbId, showTitle, firstAir, posterUrl, "tv", backdropUrl, tvResult.overview);

        if (parsed.season !== undefined && parsed.season > 0) {
          await fetchAndSaveSeasonEpisodes(showTmdbId, parsed.season, options?.signal);
        }
        mediaType = "tv";
      } else {
        mediaType = "other";
      }
    }
  }

  const epStart = parsed.episodes && parsed.episodes.length > 0 ? parsed.episodes[0] : null;
  const epEnd = parsed.episodes && parsed.episodes.length > 1 ? parsed.episodes[parsed.episodes.length - 1] : null;

  upsertTorrent(
    accountId,
    torrentId,
    null, // torrentName is only available at torrent creation, not from TorBox's mylist API files, though mylist API root gives it, processAndInsertFile is passed file only. We can pass null and it will update.
    torrentHash,
    mediaType,
    mediaType === "tv" ? parsed.title : parsed.title, // or primary title
    tmdbId
  );

  upsertRemoteFile(
    accountId,
    torrentId,
    file.id,
    remotePath,
    filename,
    shortName,
    file.size,
    mimeType,
    torrentHash,
    tmdbId,
    parsed.title,
    parsed.year || null,
    mediaType,
    mediaType === "tv" ? parsed.title : null,
    parsed.season ?? null,
    epStart,
    epEnd,
    parsed.year || null
  );

  return true;
}

export async function syncAccount(accountId: number, signal?: AbortSignal): Promise<SyncResult> {
  let cleared = false;
  let synced = false;
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

    // 3. Clear all existing remote_list_cache rows for this account (clean slate)
    //    NOTE: media & tv_episodes tables are NOT cleared — they are shared metadata caches.
    clearRemoteFilesForAccount(accountId);
    cleared = true;

    let filesSynced = 0;

    // 4. Process each torrent and its files through the shared pipeline
    for (const torrent of torrents) {
      const torrentId = torrent.id;
      const torrentHash = torrent.hash || null;

      if (!torrent.files || !Array.isArray(torrent.files)) continue;

      for (const file of torrent.files) {
        const inserted = await processAndInsertFile(
          accountId,
          torrentId,
          torrentHash,
          file,
          { signal }
        );
        if (inserted) filesSynced++;
      }
    }

    updateAccountSyncTime(accountId);
    synced = true;
    return { success: true, filesSynced };
  } catch (error) {
    console.error("Sync error:", error);
    return { success: false, filesSynced: 0, error: "Sync failed" };
  } finally {
    if (cleared && !synced) {
      updateAccountUpdatedTime(accountId);
    }
  }
}