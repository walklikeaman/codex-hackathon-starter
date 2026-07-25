// Spoiler safety — reading a map of a story you have not finished.
//
// The central decision: hiding happens in the DATABASE, not in the interface. A
// blurred card whose text sits in the JSON is not protection — DevTools defeats it in
// seconds. So this module never receives the hidden content in the first place; its
// job is to state the contract, validate the progress value, and shape what a
// withheld scene looks like.
//
// Position is treated as spoiler content. "The last chapter happens at the lighthouse"
// gives the ending away just as surely as the sentence describing it, so an unreached
// scene carries no coordinates at all.

// The safe floor: with no progress set, only tier-0 scenes are revealed — the ones
// that carry no plot information. Spoiler-safe is the DEFAULT, not an opt-in.
import { finiteOrNull, integerOrNull } from "./numbers.mjs";

export const SAFE_PROGRESS = 0;
export const MAX_PROGRESS = 9999;

export function clampProgress(value) {
  const chapter = integerOrNull(value);
  if (chapter === null) return SAFE_PROGRESS; // absent means safe, never "chapter 0 of plot"
  return Math.min(Math.max(chapter, SAFE_PROGRESS), MAX_PROGRESS);
}

// Is this scene revealed at the given progress? Mirrors the SQL, and exists so the
// client can reason about a payload without re-deriving the rule.
export function isRevealed(spoilerTier, progress) {
  // A scene with no tier recorded carries no known spoiler, so it stays visible.
  const tier = finiteOrNull(spoilerTier) ?? 0;
  return tier <= clampProgress(progress);
}

// What a withheld scene looks like: its position in the sequence, an optional
// spoiler-free teaser, and nothing else. No title, no beat, no coordinates.
export function placeholderFor(scene) {
  return {
    scene_id: scene?.scene_id ?? null,
    sequence_index: scene?.sequence_index ?? null,
    spoiler_tier: scene?.spoiler_tier ?? null,
    revealed: false,
    // The teaser is written to be safe for anyone, at any point in the story.
    safe_teaser: scene?.safe_teaser ?? null,
    label: sequenceLabel(scene?.sequence_index),
  };
}

export function sequenceLabel(index) {
  // finiteOrNull, not Number(): a scene with no index must not become "Scene 0".
  const number = finiteOrNull(index);
  return number === null ? "Later scene" : `Scene ${number}`;
}

// Normalise rows from work_scenes() for the client. Rows arrive ALREADY stripped by
// SQL; this re-asserts the shape so a future change to the query cannot quietly start
// leaking fields the UI would happily render.
export function shapeScenes(rows, progress) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!isRevealed(row?.spoiler_tier, progress) || row?.revealed === false) {
      return placeholderFor(row);
    }
    return {
      scene_id: row.scene_id ?? null,
      sequence_index: row.sequence_index ?? null,
      spoiler_tier: row.spoiler_tier ?? null,
      revealed: true,
      act_or_chapter: row.act_or_chapter ?? null,
      plot_beat: row.plot_beat ?? null,
      safe_teaser: row.safe_teaser ?? null,
      place_id: row.place_id ?? null,
      place_name: row.place_name ?? null,
      lat: finiteOrNull(row.lat),
      lng: finiteOrNull(row.lng),
      label: row.act_or_chapter ?? sequenceLabel(row.sequence_index),
    };
  });
}

// A summary the UI can show without revealing anything: how much is still ahead.
export function progressSummary(scenes) {
  const list = Array.isArray(scenes) ? scenes : [];
  const revealed = list.filter((scene) => scene.revealed).length;
  const highestTier = list.reduce(
    (max, scene) => Math.max(max, Number(scene.spoiler_tier) || 0),
    0,
  );
  return { total: list.length, revealed, hidden: list.length - revealed, highestTier };
}
