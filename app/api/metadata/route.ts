import { NextResponse } from "next/server";
import { getMetadata, setMetadata, upsertMedia, updateFileMetadata, verifyUserAccountAccess, upsertTvEpisode } from "@/lib/db";
import { searchTmdbDirect, fetchTmdbMediaDetails, fetchSeasonEpisodes } from "@/lib/tmdb";
import { getSession } from "@/lib/session";

const TMDB_API_KEY = process.env.TMDB_API_KEY;

function parseFilename(filename: string) {
  let title = filename;
  let year = "";

  // Remove extension
  title = title.replace(/\.[^/.]+$/, "");

  // Match Title and Year (e.g. Joker.2019.2160p...)
  const match = title.match(/^(.*?)[. _-](\b(?:19|20)\d{2}\b)/);
  if (match) {
    title = match[1];
    year = match[2];
  } else {
    title = title.replace(/(1080p|720p|2160p|4k|bluray|web-dl|hevc|x264|x265|remux).*/i, "");
  }

  title = title.replace(/[\._]/g, " ").trim();
  return { title, year };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const query = searchParams.get("query");
  const categoryParam = searchParams.get("category");

  // 1. Live Search for UI metadata modal
  if (action === "search" || query) {
    if (!query || query.trim().length === 0) {
      return NextResponse.json({ results: [] });
    }
    const category: "movie" | "tv" = categoryParam === "tv" ? "tv" : "movie";
    try {
      const results = await searchTmdbDirect(query.trim(), category);
      return NextResponse.json({ results });
    } catch (e: any) {
      console.error("TMDB search error:", e);
      return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }
  }

  // 2. Legacy filename lookup
  const filename = searchParams.get("filename");
  if (!filename) {
    return NextResponse.json({ error: "Filename or query is required" }, { status: 400 });
  }

  const cached = getMetadata(filename);
  if (cached && cached.poster_url) {
    return NextResponse.json({
      title: cached.title,
      year: cached.year,
      posterUrl: cached.poster_url,
      source: "cache",
    });
  }

  const { title, year } = parseFilename(filename);
  if (!TMDB_API_KEY) {
    return NextResponse.json({ title, year, posterUrl: null, error: "No TMDB API key" });
  }

  try {
    let url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
    if (year) url += `&primary_release_year=${year}`;

    let res = await fetch(url);
    let data = await res.json();
    let result = data.results?.[0];

    if (!result) {
      url = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
      if (year) url += `&first_air_date_year=${year}`;
      res = await fetch(url);
      data = await res.json();
      result = data.results?.[0];
    }

    let posterUrl: string | null = null;
    let fetchedTitle = title;
    let fetchedYear = year;

    if (result && result.poster_path) {
      posterUrl = `https://image.tmdb.org/t/p/w500${result.poster_path}`;
      fetchedTitle = result.title || result.name || title;
      const releaseDate = result.release_date || result.first_air_date;
      if (releaseDate) {
        fetchedYear = releaseDate.split("-")[0];
      }
    }

    setMetadata(filename, fetchedTitle, fetchedYear, posterUrl || "");

    return NextResponse.json({
      title: fetchedTitle,
      year: fetchedYear,
      posterUrl,
      source: "tmdb",
    });
  } catch (error) {
    console.error("TMDB API Error:", error);
    return NextResponse.json({ title, year, posterUrl: null, error: "API failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { account_id, torrent_id, file_id, tmdb_id, category, all_files_in_torrent } = body;

    const accountId = Number(account_id);
    const torrentId = Number(torrent_id);
    const tmdbId = Number(tmdb_id);
    const mediaType: "movie" | "tv" = category === "tv" ? "tv" : "movie";

    if (!accountId || !torrentId || !tmdbId || isNaN(tmdbId)) {
      return NextResponse.json(
        { error: "Missing required fields: account_id, torrent_id, tmdb_id, category" },
        { status: 400 }
      );
    }

    if (!verifyUserAccountAccess(session.userId, accountId)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // 1. Fetch canonical details directly from TMDB by ID and Category
    const details = await fetchTmdbMediaDetails(tmdbId, mediaType);
    if (!details) {
      return NextResponse.json(
        { error: `Could not find ${mediaType} with TMDB ID ${tmdbId}` },
        { status: 404 }
      );
    }

    const posterUrl = details.posterPath ? `https://image.tmdb.org/t/p/w500${details.posterPath}` : "";
    const backdropUrl = details.backdropPath ? `https://image.tmdb.org/t/p/w1280${details.backdropPath}` : "";

    // 2. Upsert into media table (composite PK: tmdb_id + media_type)
    upsertMedia(
      tmdbId,
      details.title,
      details.year,
      posterUrl,
      mediaType,
      backdropUrl,
      details.overview
    );

    // 3. Update database records (remote_list_cache & torrents)
    updateFileMetadata(
      accountId,
      torrentId,
      file_id != null ? Number(file_id) : null,
      tmdbId,
      mediaType,
      details.title,
      all_files_in_torrent === true
    );

    // 4. If TV Show, fetch and persist season episodes
    if (mediaType === "tv") {
      try {
        // Fetch Season 1 by default
        const epList = await fetchSeasonEpisodes(tmdbId, 1);
        for (const ep of epList) {
          upsertTvEpisode(tmdbId, 1, ep.episodeNumber, ep.episodeTitle, ep.overview, ep.stillUrl);
        }
      } catch (e) {
        console.error(`Failed to fetch season episodes for TV show ${tmdbId}:`, e);
      }
    }

    return NextResponse.json({
      success: true,
      media: {
        tmdbId,
        mediaType,
        title: details.title,
        year: details.year,
        posterUrl,
        backdropUrl,
        overview: details.overview,
      },
    });
  } catch (error: any) {
    console.error("Metadata update error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to update metadata" },
      { status: 500 }
    );
  }
}
