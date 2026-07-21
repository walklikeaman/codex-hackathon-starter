import { NextResponse } from "next/server";

import {
  parseTmdbMovieId,
  selectTmdbBackdrop,
  tmdbImageUrl,
} from "../../lib/tmdb-images.mjs";

const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tmdbId = parseTmdbMovieId(searchParams.get("tmdbId"));

  if (!tmdbId) {
    return NextResponse.json({ error: "tmdbId must be a positive integer" }, { status: 400 });
  }

  const accessToken = process.env.TMDB_API_READ_ACCESS_TOKEN;
  const apiKey = process.env.TMDB_API_KEY;

  if (!accessToken && !apiKey) {
    return NextResponse.json(
      { image_url: null, reason: "not_configured" },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const endpoint = new URL(`${TMDB_API_BASE_URL}/movie/${tmdbId}/images`);
  endpoint.searchParams.set("include_image_language", "en,null");
  if (apiKey) endpoint.searchParams.set("api_key", apiKey);

  try {
    const response = await fetch(endpoint, {
      headers: accessToken
        ? { Accept: "application/json", Authorization: `Bearer ${accessToken}` }
        : { Accept: "application/json" },
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      throw new Error(`TMDB responded with ${response.status}`);
    }

    const payload = await response.json();
    const backdrop = selectTmdbBackdrop(payload.backdrops);

    return NextResponse.json(
      {
        image_url: backdrop ? tmdbImageUrl(backdrop.file_path) : null,
        source_url: `https://www.themoviedb.org/movie/${tmdbId}/images/backdrops`,
      },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (error) {
    console.error("TMDB film image request failed", error);
    return NextResponse.json({ error: "Unable to retrieve a film image from TMDB" }, { status: 502 });
  }
}
