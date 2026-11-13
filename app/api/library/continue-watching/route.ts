import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { getContinueWatching } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const rows = getContinueWatching(userId, 5);

    const items = rows.map((row) => {
      const duration = row.duration_seconds;
      const percent =
        !duration || duration <= 0
          ? 0
          : Math.min(100, Math.round((row.position_seconds / duration) * 100));
      return {
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
        duration_seconds: duration,
        percent,
        last_updated: row.last_updated,
        up_next: !!row.up_next,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Continue watching API error:", error);
    return NextResponse.json({ error: "Failed to fetch continue watching" }, { status: 500 });
  }
}
