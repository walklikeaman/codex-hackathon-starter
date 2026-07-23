import { createClient } from "@supabase/supabase-js";

import {
  isLetterboxdHandle,
  letterboxdRssUrl,
  parseLetterboxdRss,
} from "../../../lib/connectors/letterboxd-rss.mjs";
import {
  dedupWorkRows,
  libraryItemsFromLetterboxd,
  worksFromLetterboxd,
} from "../../../lib/content-graph.mjs";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

// Letterboxd 403s a bare server request; a browser User-Agent gets the feed.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FEED_TIMEOUT_MS = 10_000;

function jsonError(message, status) {
  return Response.json({ error: message }, { status, headers: noStoreHeaders });
}

// Default auth: read the Supabase access token from the Authorization header and
// resolve the user id against the anon client. Injected in tests (needs no DB).
function defaultResolveUserId(env) {
  return async (request) => {
    const header = request.headers.get("authorization") || "";
    const token = header.replace(/^Bearer\s+/i, "").trim();
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!token || !url || !anonKey) return null;

    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser(token);
    if (error) return null;
    return data?.user?.id ?? null;
  };
}

// Default writer: a service-role client (bypasses RLS to upsert the shared graph;
// user rows still carry the real user_id). Returns null when unconfigured → 503.
function defaultCreateWriter(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return {
    async upsertWorks(rows) {
      const { data, error } = await client
        .from("works")
        .upsert(rows, { onConflict: "tmdb_id" })
        .select("id, tmdb_id");
      if (error) throw new Error(`works upsert failed: ${error.message}`);
      return data ?? [];
    },
    async upsertLibraryItems(rows) {
      const { error } = await client
        .from("user_library_items")
        .upsert(rows, { onConflict: "user_id, work_id, source" });
      if (error) throw new Error(`library upsert failed: ${error.message}`);
    },
  };
}

// Import a Letterboxd profile into the content graph: watched films → canonical
// `works` (shared, upserted by tmdb id) + this user's `user_library_items`.
// DI factory (like createFilmImageHandler) so the orchestration is unit-testable
// without a live Supabase or a network fetch.
export function createLetterboxdImportHandler({
  env = process.env,
  fetchImpl = (...args) => fetch(...args),
  resolveUserId,
  createWriter,
  logError = (...args) => console.error(...args),
} = {}) {
  const resolve = resolveUserId ?? defaultResolveUserId(env);
  const makeWriter = createWriter ?? (() => defaultCreateWriter(env));

  return async function POST(request) {
    let handle = null;
    try {
      handle = (await request.json())?.handle;
    } catch {
      handle = null;
    }
    if (typeof handle === "string") handle = handle.trim();
    if (!isLetterboxdHandle(handle)) {
      return jsonError("Provide a valid Letterboxd handle", 400);
    }

    const userId = await resolve(request);
    if (!userId) return jsonError("Sign in to import your library", 401);

    const writer = makeWriter(env);
    if (!writer) return jsonError("Import is not configured", 503);

    let response;
    try {
      response = await fetchImpl(letterboxdRssUrl(handle), {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        },
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError";
      logError("Letterboxd feed fetch failed", { name: error?.name });
      return jsonError("Letterboxd is unavailable right now", timedOut ? 504 : 502);
    }

    if (response.status === 404) {
      return jsonError("No Letterboxd profile with that handle", 404);
    }
    if (!response.ok) {
      return jsonError("Letterboxd rejected the request", 502);
    }

    const films = parseLetterboxdRss(await response.text());
    if (films.length === 0) {
      return Response.json(
        { handle, films: 0, works_upserted: 0, library_added: 0 },
        { headers: noStoreHeaders },
      );
    }

    try {
      const workRows = dedupWorkRows(worksFromLetterboxd(films));
      const upserted = await writer.upsertWorks(workRows);
      const workIdByKey = new Map(
        upserted.map((row) => [`tmdb:${row.tmdb_id}`, row.id]),
      );

      const libraryRows = libraryItemsFromLetterboxd(films)
        .map((entry) => {
          const workId = workIdByKey.get(entry.naturalKey);
          if (!workId) return null;
          return {
            user_id: userId,
            work_id: workId,
            source: entry.source,
            rating: entry.rating,
          };
        })
        .filter(Boolean);

      if (libraryRows.length > 0) {
        await writer.upsertLibraryItems(libraryRows);
      }

      return Response.json(
        {
          handle,
          films: films.length,
          works_upserted: upserted.length,
          library_added: libraryRows.length,
        },
        { headers: noStoreHeaders },
      );
    } catch (error) {
      logError("Letterboxd import write failed", { message: error?.message });
      return jsonError("Could not save the imported library", 502);
    }
  };
}

export const POST = createLetterboxdImportHandler();
