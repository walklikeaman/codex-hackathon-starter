// The place card, read from the end the work card does not use (step 4 of #129).
//
// `place_facts` has existed since 08.08 and until now had no caller in `app/` at all. This
// is the other end of `work_facts`: the same table, entered from the place instead of from
// the work, so a doorway where three films were shot shows three facts instead of belonging
// to whichever film happened to be asked about first. See [[fact-architecture]].
//
// **One query for the facts, and it is the same one the work card uses.** If the two cards
// ever disagree about a place, the bug is a second query somewhere — not a rendering
// difference — and that is the property this route exists to keep true.
//
// A place row and its facts arrive together because `place_facts_at` joins `places`, so
// there is no second lookup for the place's own name. Measured 02.09: 70 places in the
// graph, 92 facts, and every place has at least one — a place with no facts is not a state
// this graph can be in, which is why no rows is a 404 rather than an empty card.

import { createClient } from "@supabase/supabase-js";

import { factSentence } from "../../lib/facts.mjs";
import { formatCoordinate } from "../../lib/place-card.mjs";
import { placeSummary, precisionBadge } from "../../lib/work-profile.mjs";

export const runtime = "nodejs";

// A place changes about as often as a building does. Cached hard; nothing here is
// user-specific.
const cacheHeaders = { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };
const noStoreHeaders = { "Cache-Control": "private, no-store" };

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// How `place_evidence` files a row about a fact, per subject type. Mirrors the `case` in
// `place_facts_at`'s own evidence count, and the two must stay together: a card that
// counted 1 source and then linked none would be reporting on a table it cannot read.
const EVIDENCE_SUBJECT = Object.freeze({ work: "link", creator: "creator_link" });
const EVIDENCE_SUBJECTS = new Set(Object.values(EVIDENCE_SUBJECT));

function defaultCreateReader(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  return {
    async loadFacts(placeId) {
      const { data, error } = await client.rpc("place_facts_at", { p_place_id: placeId });
      if (error) throw new Error(`place_facts_at failed: ${error.message}`);
      return data ?? [];
    },
    // Where each fact came from, one query for the whole card. `place_facts_at` returns
    // the COUNT of these and not the rows, and a count alone cannot satisfy #129's second
    // acceptance line — every fact opens its own source on click.
    //
    // Worth having on a place card in a way it is not on a film card: there, every row
    // pointed at the same film's Wikidata entry. Here the sources are three different
    // pages, and they are the thing that tells the three facts apart.
    async loadEvidence(factIds) {
      if (factIds.length === 0) return [];
      const { data, error } = await client
        .from("place_evidence")
        .select("subject_id, subject_type, source_url, method, cited_quote, agrees")
        .in("subject_type", [...EVIDENCE_SUBJECTS])
        .in("subject_id", factIds);
      if (error) throw new Error(`place evidence load failed: ${error.message}`);
      return data ?? [];
    },
  };
}

// The place itself, taken from the first row. Every row carries the same joined place
// columns, so this is a read of what already arrived and not a second question.
export function placeIdentity(row) {
  const lat = row?.lat ?? null;
  const lng = row?.lng ?? null;
  return {
    id: row?.place_id ?? null,
    name: row?.name ?? null,
    city: row?.city ?? null,
    country: row?.country ?? null,
    lat, lng,
    // What somebody standing in the street can paste into a maps app — the same four
    // decimals the panel shows, because a page that hands over more precision than it
    // displays is inventing digits.
    coordinate: formatCoordinate(lat, lng),
    // How well we know WHERE, not how sure we are THAT. See [[three-axes]].
    precision: precisionBadge(row),
    place_class: row?.place_class ?? null,
    osm_building_id: row?.osm_building_id ?? null,
    wikidata_id: row?.wikidata_id ?? null,
    confidence: row?.confidence ?? null,
    // The place's own entry, printed once in the header. Deliberately NOT repeated onto
    // every fact: it is the same link on all of them and says nothing about any one fact.
    source_url: row?.wikidata_id ? `https://www.wikidata.org/wiki/${row.wikidata_id}` : null,
  };
}

export function createPlaceCardHandler({
  env = process.env,
  createReader,
  logError = (...args) => console.error(...args),
} = {}) {
  const makeReader = createReader ?? (() => defaultCreateReader(env));

  return async function GET(request) {
    const id = new URL(request.url).searchParams.get("id");
    // Decided here, before the database is asked anything: /place/<anything> must not be a
    // way to make us look up arbitrary strings for free.
    if (!id || !UUID.test(id)) {
      return Response.json({ error: "Provide id=<uuid>" }, { status: 400, headers: noStoreHeaders });
    }

    const reader = makeReader(env);
    if (!reader) {
      return Response.json(
        { error: "The place card is not configured" },
        { status: 503, headers: noStoreHeaders },
      );
    }

    let rows = [];
    try {
      rows = await reader.loadFacts(id);
    } catch (error) {
      // A film card without our graph is thin but still shows a poster and links. A place
      // card is nothing BUT the facts, so an empty one would read as "nothing happened
      // here" — which is a claim, and a false one. Say the lookup failed instead.
      logError("place: facts load failed", error);
      return Response.json(
        { error: "Could not read this place" },
        { status: 502, headers: noStoreHeaders },
      );
    }

    if (rows.length === 0) {
      return Response.json({ error: "No such place" }, { status: 404, headers: noStoreHeaders });
    }

    const factIds = rows.map((row) => row?.fact_id).filter(Boolean);
    let evidence = [];
    try {
      // A reader written before this route has no loadEvidence. Losing the source links is
      // worse than not having them; losing the whole card over it would be worse still.
      if (reader.loadEvidence) evidence = await reader.loadEvidence(factIds);
    } catch (error) {
      logError("place: evidence load failed", error);
    }

    const sourcesByFact = new Map();
    for (const row of evidence) {
      // `place_evidence` also files rows against a PLACE itself — where we learned the
      // building is at that coordinate. That is evidence about the pin, not about any
      // claim made here, and it must not be printed under a fact as though it backed it.
      if (!EVIDENCE_SUBJECTS.has(row?.subject_type) || !row?.source_url) continue;
      const list = sourcesByFact.get(row.subject_id) ?? [];
      list.push({
        url: row.source_url,
        method: row.method ?? null,
        // The source's own words when it gave us any. A quote is evidence; a paraphrase
        // would be us restating a claim we are asking the reader to check.
        quote: row.cited_quote ?? null,
        agrees: row.agrees !== false,
      });
      sourcesByFact.set(row.subject_id, list);
    }

    const facts = rows.map((row) => {
      const summary = placeSummary(row);
      const sources = sourcesByFact.get(row?.fact_id) ?? [];
      return {
        ...summary,
        // The sentence, resolved here so both ends of the table print the same words.
        sentence: summary.sentence ?? factSentence(row),
        sources,
        // The fact's OWN source, not the place's. On a film card these were all one link;
        // here they are the three different pages that tell the three facts apart, and a
        // fact with nothing behind it gets null rather than the place's entry standing in
        // for evidence nobody recorded.
        source_url: sources[0]?.url ?? null,
      };
    });

    return Response.json({ place: placeIdentity(rows[0]), facts }, { headers: cacheHeaders });
  };
}

export const GET = createPlaceCardHandler();
