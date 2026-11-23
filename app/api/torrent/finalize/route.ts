import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  verifyUserAccountAccess,
  updateAccountUpdatedTime,
  upsertMedia,
  upsertTorrent,
  upsertRemoteFile,
  upsertTvEpisode,
} from "@/lib/db";
import { fetchTmdbMediaDetails, fetchSeasonEpisodes } from "@/lib/tmdb";
import { processAndInsertFile, isVideoFile } from "@/lib/sync";
import { parseMediaFilename } from "@/lib/parser";

export const dynamic = "force-dynamic";

interface AccountResultRef {
  account_id: number;
  torrent_id: number;
}

interface CachedFilePayload {
  id: number;
  name: string;
  size?: number;
  short_name?: string;
  mimetype?: string;
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const {
      account_results,
      torrent_hash,
      torrent_name,
      cached_files,
      auto,
      tmdb_id,
      category,
    } = body;

    if (!Array.isArray(account_results) || account_results.length === 0) {
      return NextResponse.json({ error: "Missing account_results" }, { status: 400 });
    }

    // Verify user owns all accounts
    for (const acc of account_results as AccountResultRef[]) {
      if (!verifyUserAccountAccess(session.userId, acc.account_id)) {
        return NextResponse.json(
          { error: `Access denied for account ${acc.account_id}` },
          { status: 403 }
        );
      }
    }

    const files: CachedFilePayload[] = Array.isArray(cached_files) ? cached_files : [];

    // Path A: Auto resolution (user skipped or dismissed dialog)
    if (auto || !tmdb_id) {
      let totalInserted = 0;
      for (const acc of account_results as AccountResultRef[]) {
        for (const file of files) {
          if (!file || typeof file.id !== "number" || !file.name) continue;
          try {
            const inserted = await processAndInsertFile(
              acc.account_id,
              acc.torrent_id,
              torrent_hash || null,
              {
                id: file.id,
                name: file.name,
                short_name: file.short_name,
                size: file.size || 0,
                mimetype: file.mimetype,
              }
            );
            if (inserted) totalInserted++;
          } catch (e) {
            console.error("Auto finalize file error:", e);
          }
        }
        updateAccountUpdatedTime(acc.account_id);
      }

      return NextResponse.json({
        success: true,
        status: "completed",
        total_inserted: totalInserted,
      });
    }

    // Path B: User selected exact TMDB entry
    const mediaType: "movie" | "tv" = category === "tv" ? "tv" : "movie";
    const tmdbIdNum = Number(tmdb_id);

    // 1. Fetch TMDB details and upsert into media table
    const details = await fetchTmdbMediaDetails(tmdbIdNum, mediaType);
    if (details) {
      const posterUrl = details.posterPath
        ? `https://image.tmdb.org/t/p/w500${details.posterPath}`
        : "";
      const backdropUrl = details.backdropPath
        ? `https://image.tmdb.org/t/p/w1280${details.backdropPath}`
        : "";

      upsertMedia(
        tmdbIdNum,
        details.title,
        details.year,
        posterUrl,
        mediaType,
        backdropUrl,
        details.overview
      );
    }

    // 2. If TV series, fetch season episodes
    if (mediaType === "tv") {
      try {
        const episodes = await fetchSeasonEpisodes(tmdbIdNum, 1);
        if (Array.isArray(episodes)) {
          for (const ep of episodes) {
            upsertTvEpisode(
              tmdbIdNum,
              1,
              ep.episodeNumber,
              ep.episodeTitle,
              ep.overview,
              ep.stillUrl
            );
          }
        }
      } catch (e) {
        console.error("Failed to fetch episodes on finalize:", e);
      }
    }

    // 3. Insert all files for each account
    let totalInserted = 0;
    const primaryTitle = details?.title || torrent_name || "Media";

    for (const acc of account_results as AccountResultRef[]) {
      for (const file of files) {
        if (!file || typeof file.id !== "number" || !file.name) continue;

        const remotePath = file.name;
        const filename = file.short_name || remotePath.split("/").pop() || remotePath;

        if (!isVideoFile(filename, file.mimetype)) continue;

        const parsed = parseMediaFilename(filename);
        const epStart = parsed.episodes && parsed.episodes.length > 0 ? parsed.episodes[0] : null;
        const epEnd =
          parsed.episodes && parsed.episodes.length > 1
            ? parsed.episodes[parsed.episodes.length - 1]
            : null;

        upsertTorrent(
          acc.account_id,
          acc.torrent_id,
          torrent_name || primaryTitle,
          torrent_hash || null,
          mediaType,
          primaryTitle,
          tmdbIdNum
        );

        upsertRemoteFile(
          acc.account_id,
          acc.torrent_id,
          file.id,
          remotePath,
          filename,
          file.short_name || null,
          file.size || 0,
          file.mimetype || "application/octet-stream",
          torrent_hash || null,
          tmdbIdNum,
          primaryTitle,
          parsed.year || details?.year || null,
          mediaType,
          mediaType === "tv" ? primaryTitle : null,
          parsed.season ?? null,
          epStart,
          epEnd,
          parsed.year || details?.year || null
        );

        totalInserted++;
      }

      updateAccountUpdatedTime(acc.account_id);
    }

    return NextResponse.json({
      success: true,
      status: "completed",
      total_inserted: totalInserted,
    });
  } catch (error) {
    console.error("Finalize torrent error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to finalize torrent" },
      { status: 500 }
    );
  }
}
