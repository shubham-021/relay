import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getTvShowDetailsForUser } from "@/lib/db";
import { formatBytes } from "@/lib/utils";
import { getLibEtag, validateETag } from "@/lib/library-etag";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ showTitle: string }> }
) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { showTitle: rawShowTitle } = await params;
    const showTitle = decodeURIComponent(rawShowTitle);

    const baseEtag = getLibEtag(session.userId);
    const showHash = createHash("md5").update(`${showTitle}:${baseEtag}`).digest("hex");
    const etag = `W/"tvshow-${showHash}"`;

    const notModified = validateETag(request, etag);
    if (notModified) return notModified;

    const rawEpisodes = getTvShowDetailsForUser(session.userId, showTitle);
    if (!rawEpisodes || rawEpisodes.length === 0) {
      return NextResponse.json({ error: "Show not found" }, { status: 404 });
    }

    const first = rawEpisodes[0];
    const showInfo = {
      showTitle: first.show_name || first.show_title || showTitle,
      posterUrl: first.show_poster_url,
      backdropUrl: first.show_backdrop_url,
      overview: first.show_overview,
      tmdbId: first.tmdb_id,
    };

    // Group episodes by season
    const seasonsMap = new Map<number, any[]>();
    for (const row of rawEpisodes) {
      const sNum = row.season_number ?? 1;
      if (!seasonsMap.has(sNum)) {
        seasonsMap.set(sNum, []);
      }
      seasonsMap.get(sNum)!.push({
        id: row.id,
        account_id: row.account_id,
        torrent_id: row.torrent_id,
        file_id: row.file_id,
        remote_path: row.remote_path,
        filename: row.filename,
        short_name: row.short_name,
        size: row.size,
        sizeFormatted: formatBytes(row.size || 0),
        mime_type: row.mime_type,
        season_number: sNum,
        episode_number: row.episode_number,
        episode_end_number: row.episode_end_number,
        episode_title: row.episode_title || `Episode ${row.episode_number ?? 1}`,
        episode_overview: row.episode_overview,
        still_url: row.episode_still_url,
        torrent_name: row.torrent_name || "Unknown Torrent",
        percent: (!row.duration_seconds || row.duration_seconds <= 0) ? 0 : Math.min(100, Math.round((row.position_seconds / row.duration_seconds) * 100)),
        completed: !!row.completed,
      });
    }

    const seasons = Array.from(seasonsMap.entries()).map(([seasonNumber, episodes]) => ({
      seasonNumber,
      episodes,
    }));

    return NextResponse.json({
      show: showInfo,
      seasons,
    }, {
      headers: {
        Etag: etag,
        "Cache-Control": "private, no-cache"
      }
    });
  } catch (error) {
    console.error("TV Show Detail API error:", error);
    return NextResponse.json({ error: "Failed to fetch TV show detail" }, { status: 500 });
  }
}
