// "Add a place" (#22): a reader's suggestion, kept on this device.
//
// It is not sent anywhere, and the screen says so. The queue a suggestion would join is
// drawn on the public map as "unchecked places", so opening a write path to it is a
// decision about spam and about what strangers can put on everyone's map — the owner's
// to make, not a side effect of a navigation screen. Until then a suggestion is honest
// about where it is: saved here, not under review.

export const SUGGESTIONS_KEY = "scenemap-suggestions";
export const SUGGESTION_STATUS = Object.freeze({ savedHere: "saved_here" });

const MAX_SUGGESTIONS = 100;
const MAX_TEXT = 200;

const text = (value) => String(value ?? "").trim().slice(0, MAX_TEXT);

// Returns { suggestion } or { errors: { field: sentence } }.
export function validateSuggestion(input, { now = Date.now() } = {}) {
  const errors = {};
  const place = text(input?.place);
  const work = text(input?.work);
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  let sourceUrl = text(input?.sourceUrl) || null;

  if (place.length < 2) errors.place = "Name the place.";
  if (work.length < 1) errors.work = "Name the film, series or book.";
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    errors.position = "Choose where it is: the map's centre or your location.";
  }
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (!/^https?:$/.test(url.protocol)) throw new Error("not a web link");
      sourceUrl = url.toString();
    } catch {
      errors.sourceUrl = "A source is a web link, starting with https://.";
    }
  }
  if (Object.keys(errors).length) return { errors };

  return {
    suggestion: {
      id: `s-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      place,
      work,
      scene: text(input?.scene) || null,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      sourceUrl,
      status: SUGGESTION_STATUS.savedHere,
      at: now,
    },
  };
}

export function loadSuggestions(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SUGGESTIONS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry?.id && entry?.place && Number.isFinite(entry?.at)).slice(0, MAX_SUGGESTIONS)
      : [];
  } catch {
    return [];
  }
}

export function saveSuggestions(storage, list) {
  try {
    storage?.setItem(SUGGESTIONS_KEY, JSON.stringify(list.slice(0, MAX_SUGGESTIONS)));
  } catch {
    // Storage refused: the suggestion lasts for this visit only.
  }
}

export function suggestionStatusLabel(status) {
  return status === SUGGESTION_STATUS.savedHere ? "Saved on this device · review is not open yet" : "Unknown";
}
