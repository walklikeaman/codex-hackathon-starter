// Where a place lives, as an address somebody can send to somebody else.
//
// The mirror of [[work-url]], and deliberately the same shape: a readable half, a double
// hyphen, the uuid. The separator and the parser are IMPORTED rather than copied — a slug
// written by one of these two files and read by the other is the drift a second copy would
// eventually cause, and every link already sent assumes they agree.
//
// The readable half carries no year. A film is "skyfall-2012" because two films share a
// title; a place is "trafalgar-square" because a place is not released. Measured against
// the graph before writing this: of the 70 places, no two share a name.
//
// What a place page can promise is narrower than what a film page promises, and the URL is
// the first place that shows: only places IN THE GRAPH have one. A queue candidate has no
// canonical row, so it has no address here — see [[place-card]].

import { SLUG_SEPARATOR, slugifyTitle, uuidFromSlug } from "./work-url.mjs";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function placeSlug(place) {
  const id = String(place?.id ?? place?.place_id ?? "");
  if (!UUID.test(id)) return null;
  const readable = slugifyTitle(place?.name);
  return readable ? `${readable}${SLUG_SEPARATOR}${id}` : id;
}

export function placePath(place) {
  const slug = placeSlug(place);
  return slug ? `/place/${slug}` : null;
}

// The readable half is decorative and this proves it: rename the place, and the links
// already sent still resolve. That is the reason the uuid is in the URL at all.
export function placeIdFromSlug(slug) {
  return uuidFromSlug(slug);
}
