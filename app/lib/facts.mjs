// What a fact says, and how far it stands from the work it is shown under (#129).
//
// A fact used to be an edge: (work, place, relation_kind). The card turned that triple
// into a phrase — "Where the author worked" — because a Wikidata statement carries no
// wording of its own and a template was the only thing available.
//
// It is not the only thing available any more. A plaque hands over the whole sentence,
// already written, on the wall:
//
//   "J. K. Rowling wrote some of the early chapters of Harry Potter in the rooms on the
//    first floor of this building"
//
// Reducing that to "Where the author worked" throws away the part somebody walked across
// a city to read. So: the stored sentence wins, and the template is what we fall back to
// when a source gave us nothing but a triple.
//
// The distance is the other half. The owner wants facts about the crew and about what
// influenced a work — and that is also the main risk, because "Harry Potter places"
// becomes "places connected to anything Rowling ever touched" without anybody deciding
// to make it so. Every fact therefore carries how many degrees it stands from the work,
// and the route is drawn from the near ones.
//
// `factDistance` mirrors `fact_distance(text, text)` in
// supabase/migrations/20260808010100_a_fact_has_its_own_identity.sql. Two definitions of
// the same rule is a real cost; the alternative is a client that cannot say anything
// about a fact it did not fetch through the RPC, which is most of them.

// 0 — about the work itself: filmed here, set here, recorded here.
// 1 — about its person: the director lived here, the author wrote here.
// 2 — about what influenced it: the grave that gave a character its name.
export const DISTANCE_SELF = 0;
export const DISTANCE_PERSON = 1;
export const DISTANCE_INFLUENCE = 2;

// A route may contain the work's own places and its people's places. Distance 2 is
// "nearby, and here is why it is interesting" — a separate block, different wording, and
// never a stop somebody is told to walk to.
export const MAX_ROUTABLE_DISTANCE = DISTANCE_PERSON;

// These hang off a work_id in the schema and are still facts about a PERSON — the shape
// that existed before creator_place_links, and the reason Rowling's cafe was seven rows.
const PERSON_RELATIONS_ON_A_WORK = new Set(["author_place", "artist_place"]);

export function factDistance(fact) {
  const relation = fact?.relation_kind ?? null;
  if (relation === "inspiration_for") return DISTANCE_INFLUENCE;
  if (fact?.subject_type === "creator") return DISTANCE_PERSON;
  if (PERSON_RELATIONS_ON_A_WORK.has(relation)) return DISTANCE_PERSON;
  return DISTANCE_SELF;
}

export function isRoutableFact(fact) {
  const distance = Number.isFinite(fact?.distance) ? fact.distance : factDistance(fact);
  return distance <= MAX_ROUTABLE_DISTANCE;
}

// How a block of facts should be introduced, so distance 2 never reads as a stop.
export function distanceLabel(distance) {
  if (distance === DISTANCE_PERSON) return "Through the people who made it";
  if (distance === DISTANCE_INFLUENCE) return "Nearby, and here is why";
  return "In the work itself";
}

const TEMPLATES = {
  filming_location: (subject, place) => `${subject} was filmed at ${place}`,
  narrative_location: (subject, place) => `${subject} is set at ${place}`,
  studio_of: (subject, place) => `${subject} was made at ${place}`,
  recorded_at: (subject, place) => `${subject} was recorded at ${place}`,
  // Built for visitors and never shot in. Saying "filmed here" about the trolley in the
  // wall at King's Cross is the confident false claim the grounding rule exists to stop.
  replica: (subject, place) => `${place} was built for visitors; ${subject} was not filmed there`,
  inspiration_for: (subject, place) => `${place} is where an idea in ${subject} came from`,
  author_place: (subject, place) => `${place} is connected with the author of ${subject}`,
  artist_place: (subject, place) => `${place} is connected with the artist behind ${subject}`,
  lived_here: (subject, place) => `${subject} lived at ${place}`,
  worked_here: (subject, place) => `${subject} worked at ${place}`,
  wrote_here: (subject, place) => `${subject} wrote at ${place}`,
  died_here: (subject, place) => `${subject} died at ${place}`,
  buried_here: (subject, place) => `${subject} is buried at ${place}`,
  commemorated_here: (subject, place) => `${subject} is commemorated at ${place}`,
};

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function year(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

// The sentence a card should print. Stored wording first, verbatim and untouched — a
// source's own words are evidence, and rewriting them would make the quote unverifiable.
export function factSentence(fact) {
  const stored = text(fact?.statement);
  if (stored) return stored;

  const subject = text(fact?.subject_name);
  const place = text(fact?.place_name) ?? text(fact?.name);
  if (!subject || !place) return null;

  const template = TEMPLATES[fact?.relation_kind];
  const base = template
    ? template(subject, place)
    // An unmapped relation is not a licence to invent one. State the connection and no
    // more; a wrong verb here is a claim nobody made.
    : `${place} is connected with ${subject}`;

  const about = text(fact?.about);
  const stated = year(fact?.stated_year);
  return `${base}${about ? ` — ${about}` : ""}${stated ? ` (${stated})` : ""}.`;
}
