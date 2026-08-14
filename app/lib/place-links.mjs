// The three ways to look at a place we do not host ourselves.
//
// The card already offers "Find place images", which is a web search — useful, and not the
// same thing as standing in front of the building. A reference urbex map puts Google Maps
// and Google Earth on every pin, and for this product the reason is stronger than for
// theirs: **the question is whether this is the facade from the film**, and Street View is
// the only free way to see the facade from the pavement without going there.
//
// Deep links only. No Google tiles are pulled into our map and no imagery is embedded —
// those are not licensed for use outside Google's own surfaces. A link opens their
// product on their terms, which is exactly what a link is for.

import { finiteOrNull } from "./numbers.mjs";

function point(place) {
  const lat = finiteOrNull(place?.lat);
  const lng = finiteOrNull(place?.lng);
  if (lat === null || lng === null) return null;
  // Null Island is a legal pair of numbers and the signature of one never parsed. Four
  // incidents in this project; a link to the Gulf of Guinea is the fifth.
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// A pin, on their map. Named when we have a name, because "51.5,-0.1" tells the person
// who follows the link nothing about what they are looking for.
export function googleMapsUrl(place) {
  const at = point(place);
  if (!at) return null;
  const name = String(place?.name ?? place?.loc_name ?? "").trim();
  const query = name ? `${name} ${at.lat},${at.lng}` : `${at.lat},${at.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// The pavement view. `cbll` is the camera position and `layer=c` is what puts it in Street
// View rather than on the map; without the layer parameter the link silently degrades to
// an ordinary map, which looks like it worked.
export function streetViewUrl(place) {
  const at = point(place);
  if (!at) return null;
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at.lat},${at.lng}`;
}

// From above, in three dimensions — the view that answers "is that the same roofline".
export function googleEarthUrl(place, { altitudeMetres = 250 } = {}) {
  const at = point(place);
  if (!at) return null;
  return `https://earth.google.com/web/@${at.lat},${at.lng},${altitudeMetres}a,0d,35y,0h,45t,0r`;
}

// Everything a card should offer for one place, already filtered to what is answerable.
// A place with no usable coordinate gets an empty list rather than three links to nowhere.
export function externalPlaceLinks(place) {
  return [
    { id: "google_maps", label: "Google Maps", url: googleMapsUrl(place) },
    { id: "street_view", label: "Street View", url: streetViewUrl(place) },
    { id: "google_earth", label: "Google Earth", url: googleEarthUrl(place) },
  ].filter((link) => link.url);
}
