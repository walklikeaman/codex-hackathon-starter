"use client";

// The story trail drawn on the map (#71).
//
// This is the piece that had been extracted, tested and shipped months of work ago and
// then shown to nobody, because everything new was queued behind "where does it go in
// the panel?". It never belonged in the panel: a numbered path between real places is
// a MAP object.
//
// Two lines can appear at once and they mean opposite things, so they are drawn to be
// unmistakable:
//
//   * the walking route is SOLID — how you get there;
//   * the story trail is DASHED and numbered — how the story moves, which may double
//     back past a place you already passed.
//
// Confusing them would tell someone to walk in the order the plot happens, which is
// exactly the wrong instruction.

import { isWalkableStop, trailPath } from "../lib/story-trail.mjs";
import { MapMarker, RouteLine } from "./map/layers.jsx";

// Numbers, not pins: the position in the story IS the information here, and a marker
// that merely repeats "a place" adds nothing next to the pins already on the map.
//
// These stay DOM markers rather than a GPU layer, and that is deliberate. There are a
// handful of them, they carry a number and a title, and they are clicked — a layer would be
// the same mistake as a marker per pin, made in the other direction.
function stopClasses({ isNext, walkable }) {
  // An area gets a different mark on purpose. A numbered pin says "stand here", and for a
  // city centroid there is no here — the film was shot somewhere in that city, and we do not
  // know where. Saying that plainly is the whole product.
  return ["trail-stop", isNext ? "is-next" : "", walkable ? "" : "is-area"]
    .filter(Boolean).join(" ");
}

export default function StoryTrail({ stops, nextStopId = null, onSelect }) {
  const ordered = [...(stops ?? [])].sort((a, b) => a.sequence_index - b.sequence_index);
  if (ordered.length === 0) return null;

  const path = trailPath(ordered);

  return (
    <>
      {/* Dashed and thinner than the walking route, deliberately — see above. */}
      <RouteLine id="story-trail" positions={path} dashed color="#7cc4ff" />

      {ordered.map((stop) => {
        const walkable = isWalkableStop(stop);
        return (
          <MapMarker
            key={stop.id}
            position={stop.position}
            className={stopClasses({ isNext: stop.id === nextStopId, walkable })}
            onClick={onSelect ? () => onSelect(stop) : undefined}
            // The place name only. The plot beat is withheld on purpose — the spoiler
            // shield decides what a reader has earned, and a map label is not the place
            // to quietly bypass it. A `title` is the browser's own tooltip, which costs
            // nothing and cannot be styled into saying more than it should.
            title={walkable
              ? `${stop.sequence_index}. ${stop.place}`
              : `${stop.sequence_index}. Somewhere in ${stop.place} — exact spot unknown`}
          >
            {walkable ? stop.sequence_index : "~"}
          </MapMarker>
        );
      })}
    </>
  );
}
