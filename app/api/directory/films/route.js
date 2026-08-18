// One letter of the A-Z directory (#158).
//
// The letter is resolved from a slug before anything is asked of the database, so an
// unknown letter is a 404 here rather than a scan of the catalogue. '#' arrives as
// "other", because a '#' in a URL is the fragment delimiter and never reaches the server.

import { createClient } from "@supabase/supabase-js";

import {
  OTHER_LETTER,
  WORKS_PER_PAGE,
  letterFromSlug,
  paginate,
} from "../../../lib/directory.mjs";

export const runtime = "nodejs";

const cacheHeaders = { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };
const noStoreHeaders = { "Cache-Control": "private, no-store" };

function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return {
    async loadLetter({ letter, limit, offset }) {
      const { data, error } = await client.rpc("catalogue_letter", {
        // '#' is not a letter the function knows; it takes anything that is not a single
        // a-z character as "everything else", which is the same rule letterBucket() uses.
        p_letter: letter === OTHER_LETTER ? null : letter,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw new Error(`catalogue_letter failed: ${error.message}`);
      return data ?? [];
    },
  };
}

export function createDirectoryFilmsHandler({
  env = process.env,
  createReader,
  perPage = WORKS_PER_PAGE,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET(request) {
    const params = new URL(request.url).searchParams;
    const letter = letterFromSlug(params.get("letter"));
    if (!letter) {
      return Response.json({ error: "No such letter" }, { status: 404, headers: noStoreHeaders });
    }

    const reader = makeReader(env);
    if (!reader) {
      return Response.json({ error: "The directory is not configured" }, { status: 503, headers: noStoreHeaders });
    }

    try {
      const requested = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
      let rows = await reader.loadLetter({ letter, limit: perPage, offset: (requested - 1) * perPage });
      let page = paginate({ total: rows[0]?.total_works ?? 0, page: requested, perPage });

      if (rows.length === 0 && requested > 1) {
        rows = await reader.loadLetter({ letter, limit: perPage, offset: 0 });
        page = paginate({ total: rows[0]?.total_works ?? 0, page: 1, perPage });
      }

      return Response.json(
        {
          letter,
          works: rows.map((row) => ({
            id: row.work_id,
            title: row.title,
            title_norm: row.title_norm,
            year: row.year,
            kind: row.kind,
            place_count: row.place_count,
          })),
          page,
        },
        { headers: cacheHeaders },
      );
    } catch (error) {
      logError("directory-films", error);
      return Response.json({ error: "The directory is unavailable" }, { status: 502, headers: noStoreHeaders });
    }
  };
}

export const GET = createDirectoryFilmsHandler();
