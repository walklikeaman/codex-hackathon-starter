// The film profile: everything we can say about one work, and how sure we are.
//
// The product's whole claim is "we found where this was filmed". A profile is where
// that claim is laid out per place, so this module's job is to keep three different
// kinds of statement visibly apart:
//
//   * filmed HERE, on this street            → a real place, badged by precision
//   * filmed at a STUDIO, depicting elsewhere → the studio's own coordinate, flagged
//   * set here in the story, never filmed     → a narrative place, never a filming claim
//
// Stills follow the same rule. A frame may sit next to a PLACE only when something
// verified that it depicts that place; otherwise it belongs to the film and says so.
// A gallery of "frames from this film" is honest; the same frames pinned to a street
// would be an invention.

import { parseTmdbMovieId } from "./tmdb-images.mjs";
import { imdbUrl, metacriticUrl, rottenTomatoesUrl } from "./work-ratings.mjs";
import { finiteOrNull } from "./numbers.mjs";
import { distanceLabel, factDistance, factSentence, isRoutableFact } from "./facts.mjs";

export const MAX_PROFILE_PLACES = 60;
export const MAX_PROFILE_STILLS = 12;

const KINDS = Object.freeze({ film: "movie", series: "tv" });

// Classes that mean "the camera was physically here". `studio_interior` is filming
// too, but it is a claim about a soundstage, not about the street it portrays.
const ON_LOCATION = new Set(["real_exterior", "real_interior"]);

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Two callers, two keys. The live map chips only ever have a TMDB id; the graph layer
// only has our own uuid — and the graph layer holds the works with the MOST places, so
// serving only one of them would put the profile out of reach of our best data.
export function parseProfileQuery(searchParams) {
  const id = searchParams?.get?.("id");
  if (typeof id === "string" && UUID.test(id)) return { workId: id };

  for (const kind of Object.keys(KINDS)) {
    const tmdbId = parseTmdbMovieId(searchParams?.get?.(kind));
    if (tmdbId) return { kind, tmdbId };
  }
  return null;
}

// How a place relates to the work, taken from `place_class` and `relation_kind` —
// NEVER from the name. The old scene-image matcher tested /studio/i against the place
// name, which calls the "Studio Ghibli Museum" a soundstage and misses any lot whose
// name does not contain the word. The resolver already derived this properly from
// Wikidata P31 ancestry, and that answer is one join away.
export function placeRole(place) {
  const placeClass = place?.place_class ?? "unknown";
  const relation = place?.relation_kind ?? "filming_location";

  if (placeClass === "fictional") {
    return { role: "fictional", mappable: false, label: "Fictional place" };
  }
  if (relation === "narrative_location" || placeClass === "narrative_real") {
    // Set here, not shot here. Two different facts that a single pin would blur.
    return { role: "narrative", mappable: true, label: "Set here in the story" };
  }
  // Neither filmed nor set here — this is where something CAME FROM. Thomas Riddell's
  // grave gave a character its name; Harry Potter does not happen in Greyfriars
  // Kirkyard. Without a role of its own the only options were to call it a filming
  // location, which is false, or to drop it, which is what used to happen.
  if (relation === "inspiration_for") {
    return { role: "inspiration", mappable: true, label: "The idea came from here" };
  }
  // Built for visitors and never shot in: Bagshot Row's interior, the Green Dragon,
  // the trolley in the wall at King's Cross while the films used platforms 4 and 5.
  // Saying "filmed here" about these is the confident false claim the whole grounding
  // rule exists to prevent, and it is worse than an imprecise pin because nothing
  // about it looks wrong.
  if (relation === "replica") {
    return { role: "replica", mappable: true, label: "Built for visitors, not filmed here" };
  }
  if (relation === "author_place") {
    return { role: "author", mappable: true, label: "Where the author worked" };
  }
  if (placeClass === "studio_interior") {
    return { role: "studio", mappable: true, label: "Filmed at a studio" };
  }
  if (ON_LOCATION.has(placeClass)) {
    return { role: "on_location", mappable: true, label: "Filmed on location" };
  }
  return { role: "unknown", mappable: true, label: "Location unconfirmed" };
}

// The precision badge (#44): how well do we know WHERE, not how sure we are THAT.
export function precisionBadge(place) {
  const precision = String(place?.geocode_precision ?? "").toLowerCase();
  if (place?.osm_building_id || precision === "building") return "Building";
  if (precision === "street") return "Street";
  if (precision === "point") return "Exact point";
  if (precision === "city") return "City only";
  if (precision === "country" || precision === "region") return "Region only";
  return "Unknown precision";
}

export function placeSummary(place) {
  const role = placeRole(place);
  const lat = finiteOrNull(place?.lat);
  const lng = finiteOrNull(place?.lng);
  // A fact row carries its own distance from work_facts(); a bare place row does not,
  // and deriving it here means a caller that has not moved to the RPC still gets an
  // honest answer rather than a missing field the client reads as zero.
  const distance = Number.isFinite(place?.distance) ? place.distance : factDistance(place);

  return {
    id: place?.place_id ?? place?.id ?? null,
    fact_id: place?.fact_id ?? null,
    // WHO this fact is about. A film's card shows facts about the film and facts about
    // the people who made it, and a reader must be able to tell which is which.
    subject_type: place?.subject_type ?? "work",
    subject_name: place?.subject_name ?? null,
    // The subject's own id and kind, so a card that is NOT the subject's can link to it.
    // A film card never needs either — every subject on it is that film. A place card is
    // the other end of the same table ([[place-card]]) and its subjects are three films, a
    // series and a book, so it has to be able to say which and address each one.
    // `work_facts` returns no `subject_kind`; null there is the honest answer, not a gap.
    subject_id: place?.subject_id ?? null,
    subject_kind: place?.subject_kind ?? null,
    about: place?.about ?? null,
    stated_year: finiteOrNull(place?.stated_year),
    // The source's own words when we have them; the template only when we do not.
    sentence: factSentence(place),
    distance,
    distance_label: distanceLabel(distance),
    // Distance 2 is "nearby, and here is why it is interesting" — never a stop somebody
    // is told to walk to. The interface needs that as a flag, not as a rule it re-derives.
    routable: isRoutableFact({ ...place, distance }),
    name: place?.name ?? null,
    city: place?.city ?? null,
    country: place?.country ?? null,
    lat, lng,
    role: role.role,
    role_label: role.label,
    // The studio flag the product needs: the pin is real, what it depicts is not here.
    depicts_elsewhere: role.role === "studio",
    precision: precisionBadge(place),
    osm_building_id: place?.osm_building_id ?? null,
    confidence: finiteOrNull(place?.confidence),
    wikidata_id: place?.wikidata_id ?? null,
    // How many sources back this fact. Carried to the card and printed even when it is
    // zero: a place with nothing recorded behind it is a thing a reader is entitled to
    // notice, and 8 of the 92 links in the graph are exactly that.
    evidence_count: Number.isFinite(Number(place?.evidence_count)) ? Number(place.evidence_count) : null,
    // Which scene, when a fact came from one. London holds four Skyfall facts and three of
    // them are narrative facts with nothing else to tell them apart — same subject, same
    // relation, no stated sentence. Without the scene they print as one line three times,
    // which reads as a rendering bug and hides that they are three different scenes.
    scene_id: place?.scene_id ?? null,
    narrative_order: Number.isInteger(place?.narrative_order) ? place.narrative_order : null,
    source_url: place?.wikidata_id ? `https://www.wikidata.org/wiki/${place.wikidata_id}` : null,
  };
}

// On-location places first: they are the answer to the question the product asks.
// Studio and narrative places are real information, but they are not "we found the
// street", so burying them under the finds is the honest order.
const ROLE_ORDER = ["on_location", "unknown", "studio", "narrative", "fictional"];

export function sortPlaces(places) {
  return [...places].sort((a, b) => {
    // Distance outranks role: "the director lived here" is a real find, and it still
    // belongs below every place the film itself was shot at. Without this, one plaque
    // about a screenwriter outranks the street in the opening shot.
    const byDistance = (a.distance ?? 0) - (b.distance ?? 0);
    if (byDistance !== 0) return byDistance;
    const byRole = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (byRole !== 0) return byRole;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

export function profilePlaces(rows) {
  return sortPlaces((Array.isArray(rows) ? rows : []).map(placeSummary))
    .slice(0, MAX_PROFILE_PLACES);
}

// One line per place-kind, so the profile can state its coverage without the reader
// counting rows — and without implying a studio pin is a street find.
export function placeTally(places) {
  const tally = { on_location: 0, studio: 0, narrative: 0, fictional: 0, unknown: 0 };
  for (const place of places) tally[place.role] = (tally[place.role] ?? 0) + 1;
  return tally;
}

// Every external page about this work. These are LINKS, not content: IMDb's terms
// forbid extracting their images and text, and nothing here does — it points at them.
export function sourceLinks(work) {
  const links = [];
  if (work?.imdb_id) links.push({ label: "IMDb", url: imdbUrl(work.imdb_id) });
  if (work?.rt_path) links.push({ label: "Rotten Tomatoes", url: rottenTomatoesUrl(work.rt_path) });
  if (work?.mc_path) links.push({ label: "Metacritic", url: metacriticUrl(work.mc_path) });
  if (work?.tmdb_id && KINDS[work.kind]) {
    links.push({ label: "TMDB", url: `https://www.themoviedb.org/${KINDS[work.kind]}/${work.tmdb_id}` });
  }
  if (work?.wikidata_id) {
    links.push({ label: "Wikidata", url: `https://www.wikidata.org/wiki/${work.wikidata_id}` });
  }
  return links.filter((link) => link.url);
}

// Stored ratings, each carrying the page it came from so a reader can check it.
export function profileRatings(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.display)
    .map((row) => ({
      source: row.source,
      display: row.display,
      score: finiteOrNull(row.score),
      votes: finiteOrNull(row.votes),
      url: row.source_url ?? null,
    }));
}
