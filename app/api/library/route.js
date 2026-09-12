// What the account holds, for the caller who owns it (#191).
//
// `POST /api/trip/plan` can filter by the list on an account. An agent that can send that
// request and cannot ask what the list IS has to guess whether the filter did anything —
// and "no stops" then means both "your films are not here" and "your list never arrived",
// which are different problems with different fixes.
//
// **It answers with a count and a sample, never the whole list.** The library is the one
// piece of personal data this product holds; a route that dumps 2,798 titles to anybody
// holding a token is a bigger target than a route that says "2,798, the most recent five".
// The agent needs to know the filter is live, not to own a copy.
//
// Read under the ANON key with the caller's own token, so row-level security decides which
// row comes back. A service-role read would return any user id the caller named.

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

// Enough to recognise the list as yours, not enough to be a copy of it.
const SAMPLE_SIZE = 5;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

function defaultReadLibrary(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return async (token) => {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth?.user?.id) return null;

    const { data, error } = await client
      .from("user_media_libraries")
      .select("movies, updated_at")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (error) throw new Error(`library read failed: ${error.message}`);

    return {
      movies: Array.isArray(data?.movies) ? data.movies : [],
      updatedAt: data?.updated_at ?? null,
    };
  };
}

export function createLibraryHandler({
  env = process.env,
  readLibrary,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = readLibrary ?? (() => defaultReadLibrary(env));

  return async function GET(request) {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonError("Send Authorization: Bearer <token>", 401);

    const read = makeReader(env);
    if (!read) return jsonError("Accounts are not configured", 503);

    let result;
    try {
      result = await read(token);
    } catch (error) {
      logError("Library read failed", { message: error?.message });
      return jsonError("Could not read the library on this account", 502);
    }
    if (!result) return jsonError("That token does not identify an account", 401);

    const { movies, updatedAt } = result;
    // `Number(null)` is 0 and `Number.isFinite(0)` is true, so every unrated film counted
    // as rated — the same confusion between "no rating" and "a rating of zero" that
    // [[notable-here]] had to fix, caught here by a test rather than by a reader.
    const rated = movies.filter((movie) => movie?.rating !== null
      && movie?.rating !== undefined
      && movie?.rating !== ""
      && Number.isFinite(Number(movie.rating)));

    return Response.json({
      titles: movies.length,
      rated: rated.length,
      updated_at: updatedAt,
      sources: [...new Set(movies.flatMap((movie) => movie?.sources ?? []))].sort(),
      // Newest first where a date exists, because the recent end is what a person
      // recognises as theirs.
      sample: [...movies]
        .sort((a, b) => String(b?.watchedDate ?? "").localeCompare(String(a?.watchedDate ?? "")))
        .slice(0, SAMPLE_SIZE)
        .map((movie) => ({ title: movie.title, year: movie.year ?? null, rating: movie.rating ?? null })),
      note: "A count and a sample. The list itself is never returned — pass `useStoredLibrary: true`"
        + " to POST /api/trip/plan to filter a plan by it.",
    }, { headers: noStoreHeaders });
  };
}

export const GET = createLibraryHandler();
