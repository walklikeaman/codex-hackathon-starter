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

import { Marker, Polyline, Tooltip } from "react-leaflet";
import L from "leaflet";

import { isWalkableStop, trailPath } from "../lib/story-trail.mjs";

// Numbers, not pins: the position in the story IS the information here, and a marker
// that merely repeats "a place" adds nothing next to the pins already on the map.
function stopIcon(index, { isNext, walkable }) {
  // An area gets a different mark on purpose. A numbered pin says "stand here", and
  // for a city centroid there is no here — the film was shot somewhere in that city,
  // and we do not know where. Saying that plainly is the whole product.
  const classes = ["trail-stop", isNext ? "is-next" : "", walkable ? "" : "is-area"]
    .filter(Boolean).join(" ");
  return L.divIcon({
    className: "",
    html: `<span class="${classes}">${walkable ? index : "~"}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export default function StoryTrail({ stops, nextStopId = null, onSelect }) {
  const ordered = [...(stops ?? [])].sort((a, b) => a.sequence_index - b.sequence_index);
  if (ordered.length === 0) return null;

  const path = trailPath(ordered);

  return (
    <>
      {path.length > 1 && (
        <Polyline
          positions={path}
          pathOptions={{
            color: "#7cc4ff",
            // Dashed and thinner than the walking route, deliberately — see above.
            dashArray: "2 9",
            weight: 3,
            opacity: 0.85,
          }}
        />
      )}
      {ordered.map((stop) => (
        <Marker
          key={stop.id}
          position={stop.position}
          icon={stopIcon(stop.sequence_index, {
            isNext: stop.id === nextStopId,
            walkable: isWalkableStop(stop),
          })}
          eventHandlers={onSelect ? { click: () => onSelect(stop) } : undefined}
        >
          {/* The place name only. The plot beat is withheld here on purpose — the
              spoiler shield decides what a reader has earned, and a map tooltip is
              not the place to quietly bypass it. */}
          <Tooltip direction="top" offset={[0, -12]}>
            {isWalkableStop(stop)
              ? `${stop.sequence_index}. ${stop.place}`
              : `${stop.sequence_index}. Somewhere in ${stop.place} — exact spot unknown`}
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
