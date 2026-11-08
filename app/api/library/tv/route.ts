import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getTvShowsForUser } from "@/lib/db";
import { getLibEtag, validateETag } from "@/lib/library-etag";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const accountIdParam = request.nextUrl.searchParams.get("account_id");
    const accountId = accountIdParam ? parseInt(accountIdParam, 10) : undefined;

    const etag = getLibEtag(session.userId, accountId);
    const notModified = validateETag(request, etag);
    if (notModified) return notModified;

    const rawShows = getTvShowsForUser(session.userId, accountId);

    const shows = rawShows.map((row) => ({
      show_title: row.show_title,
      tmdb_id: row.tmdb_id,
      poster_url: row.poster_url,
      backdrop_url: row.backdrop_url,
      overview: row.overview,
      season_count: row.season_count,
      episode_count: row.episode_count,
      start_year: row.start_year,
    }));

    return NextResponse.json({ shows }, {
      headers: {
        Etag: etag,
        "Cache-Control": "private, no-cache"
      }
    });
  } catch (error) {
    console.error("TV Shows API error:", error);
    return NextResponse.json({ error: "Failed to fetch TV shows" }, { status: 500 });
  }
}
