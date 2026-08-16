// How the film card arranges what we know, and what it refuses to blur.
//
// `/api/work` already returns everything: each place with the sentence its source stated,
// its precision badge, its evidence count, and — since #129 — how many degrees it stands
// from the film. Nothing has ever rendered the last one. The card is where that stops
// being a column in a response and starts being the thing that keeps the product honest.
//
// **Distance is the spine.** The owner wants places reached through the crew and through
// what influenced a work, and that is also the way this product could quietly start lying:
// "Harry Potter places" becoming "places connected to anything Rowling ever touched". So
// the card never prints one flat list. It prints blocks, in order, and the block for
// distance 2 is worded so that nobody reads it as a stop on a walk.

import { DISTANCE_INFLUENCE, DISTANCE_PERSON, DISTANCE_SELF, distanceLabel } from "./facts.mjs";

// What each block promises, in the card's own words. `distanceLabel` gives the heading;
// this gives the sentence under it, which is where the promise is actually made or
// withheld.
const BLOCK_NOTE = {
  [DISTANCE_SELF]: "Filmed here, set here, or recorded here.",
  [DISTANCE_PERSON]: "Reached through the people who made it — they worked, lived or are remembered here.",
  [DISTANCE_INFLUENCE]:
    "Where an idea came from. Not a filming location, and not a stop on the walk.",
};

export const ROUTE_BLOCK_DISTANCES = Object.freeze([DISTANCE_SELF, DISTANCE_PERSON]);

// Group the card's places into blocks by distance, dropping blocks nobody has anything in.
//
// An empty block is not printed. A film with no crew places should not show an empty
// "Through the people who made it" heading — a heading over nothing reads as a gap in the
// data rather than as an absence of that kind of fact.
export function placeBlocks(places) {
  const byDistance = new Map();
  for (const place of Array.isArray(places) ? places : []) {
    const distance = Number.isFinite(place?.distance) ? place.distance : DISTANCE_SELF;
    if (!byDistance.has(distance)) byDistance.set(distance, []);
    byDistance.get(distance).push(place);
  }

  return [...byDistance.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([distance, items]) => ({
      distance,
      heading: distanceLabel(distance),
      note: BLOCK_NOTE[distance] ?? BLOCK_NOTE[DISTANCE_SELF],
      // A block whose places may be walked to is the route; distance 2 is not, and the
      // flag travels with the block so the button cannot appear over the wrong one.
      routable: ROUTE_BLOCK_DISTANCES.includes(distance),
      places: items,
    }));
}

// One line stating coverage, printed before the blocks.
//
// It exists because thin coverage and a broken page look identical otherwise. 39.8% of the
// works in the queue have exactly one place; a card that shows one pin with no comment
// invites the reader to assume something failed.
export function coverageLine({ places, tally }) {
  const all = Array.isArray(places) ? places : [];
  if (all.length === 0) return "No places recorded for this work yet.";

  const routable = all.filter((place) => place.routable !== false).length;
  const nearby = all.length - routable;
  const onLocation = Number(tally?.on_location ?? 0);

  const parts = [`${all.length} place${all.length === 1 ? "" : "s"}`];
  if (onLocation > 0) parts.push(`${onLocation} filmed on location`);
  if (nearby > 0) parts.push(`${nearby} nearby rather than in the film`);
  return `${parts.join(" · ")}.`;
}

// Which stills may be shown and what the caption is allowed to claim.
//
// Two tiers, and conflating them is the failure this project already shipped once. A frame
// matched to a place carries a `place_frames` row and may say so. Everything else is a
// picture from the film's gallery: real, and evidence of nothing about any street.
export function stillsCaption({ stills, verified, note }) {
  const count = Array.isArray(stills) ? stills.length : 0;
  if (count === 0) return null;
  if (note) return note;
  return verified
    ? "Frames checked against this film's places."
    : "Frames from the film. Not matched to any location.";
}

// The external links a card may print for the work itself, already filtered. `/api/work`
// builds them from ids we hold; a work we hold no id for gets none rather than a row of
// dead buttons.
export function workLinks(links) {
  return (Array.isArray(links) ? links : []).filter((link) => link?.url && link?.label);
}
