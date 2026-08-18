// The directory index (#158): every city we offer, with what it actually holds.
//
// One request for the whole list, not one per city. `city_catalogue_totals` takes the
// gazetteer's anchors as JSON and answers with a count each, which is what lets the index
// print live numbers instead of numbers that were true when the file was written. The
// gazetteer travels TO the database rather than living in it, because adding a city must
// be a commit and not a migration — see app/lib/city-gazetteer.mjs.

import { createClient } from "@supabase/supabase-js";

import { ALL_CITIES, cityAnchors } from "../../../lib/city-gazetteer.mjs";

export const runtime = "nodejs";

// An ingest moves these numbers a few times a week at most, and a stale count only ever
// understates what we hold. Same policy as /api/catalogue.
const cacheHeaders = { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };
const noStoreHeaders = { "Cache-Control": "private, no-store" };

function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return {
    async loadCityTotals(anchors) {
      const { data, error } = await client.rpc("city_catalogue_totals", { p_anchors: anchors });
      if (error) throw new Error(`city_catalogue_totals failed: ${error.message}`);
      return data ?? [];
    },
    async loadLetterTotals() {
      const { data, error } = await client.rpc("catalogue_letter_totals");
      if (error) throw new Error(`catalogue_letter_totals failed: ${error.message}`);
      return data ?? [];
    },
  };
}

export function createDirectoryCitiesHandler({
  env = process.env,
  createReader,
  cities = ALL_CITIES,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET() {
    const reader = makeReader(env);
    if (!reader) {
      return Response.json({ error: "The directory is not configured" }, { status: 503, headers: noStoreHeaders });
    }

    try {
      // Both halves of the index at once. They are independent queries against the same
      // connection, so awaiting them together costs one round trip rather than two.
      const [cityTotals, letterTotals] = await Promise.all([
        reader.loadCityTotals(cityAnchors(cities)),
        reader.loadLetterTotals(),
      ]);

      const bySlug = new Map((cityTotals ?? []).map((row) => [row.slug, row]));
      // The gazetteer is the source of the LIST; the database only says how much is in
      // each. A city the query said nothing about is shown at zero rather than dropped —
      // vanishing on an empty answer is how a directory quietly hides a broken query.
      const withCounts = cities.map((city) => ({
        ...city,
        works: bySlug.get(city.slug)?.works ?? 0,
        points: bySlug.get(city.slug)?.points ?? 0,
      }));

      const letters = Object.fromEntries(
        (letterTotals ?? []).map((row) => [row.letter, row.works]),
      );
      // Both halves of the index's headline are measured over the same rows. Summing the
      // CITY points here instead would have printed "6,392 films with 20,296 places" — a
      // global work count beside a count of only what happens to sit near a listed city.
      const works = (letterTotals ?? []).reduce((sum, row) => sum + (row.works ?? 0), 0);
      const points = (letterTotals ?? []).reduce((sum, row) => sum + (row.points ?? 0), 0);

      return Response.json({ cities: withCounts, letters, works, points }, { headers: cacheHeaders });
    } catch (error) {
      logError("directory-cities", error);
      return Response.json({ error: "The directory is unavailable" }, { status: 502, headers: noStoreHeaders });
    }
  };
}

export const GET = createDirectoryCitiesHandler();
