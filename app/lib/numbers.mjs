// Number parsing that refuses to invent a value.
//
// This exists because one mistake kept reappearing: `Number(null)`, `Number(undefined)`
// and `Number("")` are all **0**, a perfectly valid-looking number. Over this codebase
// that produced, four separate times:
//
//   * a coordinate-less place pinned at 0,0 — Null Island, in the Gulf of Guinea;
//   * a missing map bbox parsed as a real viewport;
//   * a photo search with no coordinates looking off the coast of Africa;
//   * a scene with no index labelled "Scene 0".
//
// The rule: an ABSENT value is not zero. Parse through these helpers, and a missing
// input comes back as null — which callers must then handle deliberately.

// A finite number, or null. Absent values (null / undefined / blank) are never 0.
export function finiteOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// A finite number inside [min, max], or null.
export function inRangeOrNull(value, { min, max }) {
  const number = finiteOrNull(value);
  if (number === null) return null;
  return number >= min && number <= max ? number : null;
}

// A whole number, or null. Truncates rather than rounds: "chapter 7.9" is chapter 7.
export function integerOrNull(value) {
  const number = finiteOrNull(value);
  return number === null ? null : Math.trunc(number);
}

// A latitude/longitude pair, or null if either is absent or out of range.
export function coordinateOrNull(lat, lng) {
  const latitude = inRangeOrNull(lat, { min: -90, max: 90 });
  const longitude = inRangeOrNull(lng, { min: -180, max: 180 });
  return latitude === null || longitude === null ? null : { lat: latitude, lng: longitude };
}
