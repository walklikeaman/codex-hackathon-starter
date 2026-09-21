// A "no" from the card's matcher, remembered with exactly what it was a "no" to.
//
// A found frame is a claim about the world and goes on our rows (card-frames.mjs). A
// miss is not a claim about anything but the inputs: this matcher, shown these frames
// against this reference photo, found none it would stand behind. So the verdict is
// stored beside a fingerprint of everything the model was shown, and it answers again
// only while that fingerprint still holds.
//
// **No expiry date.** A date is a guess at when the world changes; the fingerprint IS
// the world as far as this verdict is concerned. TMDB adding a backdrop, Wikidata giving
// the place a photo or a new label, the place becoming a studio, or the matcher version
// changing each produce a miss here, and the question is asked again. Nothing else does.
//
// **What it still costs.** Checking the fingerprint needs the current inputs, so a
// remembered "no" still asks Wikidata and TMDB — measured under a second together on
// production — and skips the two vision calls that took 10-12 s.
//
// **What it gives up.** The matcher is a model and is not deterministic: asked the same
// question twice it has occasionally answered differently. A remembered "no" stops that
// second roll. That is the point — it was paying for the roll — but it is a trade, and a
// frame somebody knows exists will not appear until the inputs or the matcher change.

import { createHash } from "node:crypto";

// Only the verdict that cost something is kept. The other empty answers — no backdrops
// at all, no photo of the place, a pair Wikidata does not state — are reached before any
// model is asked, cost well under a second, and are already held by the CDN for a day.
export const REMEMBERED_REASONS = Object.freeze(["no_high_confidence_match"]);

// Everything the model is shown, in a fixed order, and nothing it is not. Labels are in
// because they are in the prompt; the candidate order is in because the model answers by
// index; the matcher version is kept separately so a bump reads as a bump.
export function sceneInputsHash({ tmdbId, sceneContext, candidatePaths, studio }) {
  const canonical = JSON.stringify([
    String(tmdbId ?? ""),
    sceneContext?.filmTitle ?? null,
    sceneContext?.place ?? null,
    sceneContext?.locationImageUrl ?? null,
    Boolean(studio),
    Array.isArray(candidatePaths) ? candidatePaths : [],
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function verdictIsCurrent(row, { matcherVersion, inputsHash }) {
  if (!row || !REMEMBERED_REASONS.includes(row.reason)) return false;
  return row.matcher_version === matcherVersion && row.inputs_hash === inputsHash;
}

export function verdictRow({ workId, locationId, matcherVersion, inputsHash, matchConfidence, candidates }) {
  if (!/^Q[1-9]\d*$/.test(workId ?? "") || !/^Q[1-9]\d*$/.test(locationId ?? "")) return null;
  if (!/^[0-9a-f]{64}$/.test(inputsHash ?? "")) return null;
  return {
    work_qid: workId,
    place_qid: locationId,
    matcher_version: matcherVersion,
    inputs_hash: inputsHash,
    reason: "no_high_confidence_match",
    match_confidence: typeof matchConfidence === "string" ? matchConfidence : null,
    candidates: Number.isInteger(candidates) && candidates >= 0 ? candidates : 0,
    // Set explicitly: an upsert over an older verdict must say when THIS one was reached.
    judged_at: new Date().toISOString(),
  };
}

// The same payload a fresh "no" returns, so the card cannot tell them apart except by
// the flag and the speed.
export function payloadFromVerdict(row, { sourceUrl }) {
  return {
    image_url: null,
    source_url: sourceUrl,
    frames: [],
    match_confidence: row.match_confidence ?? "none",
    reason: row.reason,
    stored: true,
  };
}
