// Fan wikis, and the reversal of a refusal.
//
// [[source-evaluation]] refused Fandom in July on the grounds that a row there is an
// anonymous, unsourced claim. **That reasoning does not survive contact with what this
// project already does.** We ingest 30,147 MovieMaps rows, 8,062 ReelStreets and 5,580
// MovieLocations — every one of them a fan project, every one anonymous and aggregated —
// under the owner's rule of 05.08: take the source and mark it unverified rather than
// throw the candidate away. Fandom was held to a standard the rest of the corpus is not.
//
// The owner's argument, 10.09: film-location knowledge is fan-produced by nature. That is
// simply true — all three sources above are fan projects — and the refusal was the
// inconsistency, not the request.
//
// **What the July check got wrong, and what it got right.** It looked at the "Filming
// locations" CATEGORY and found it empty on the Bond, LOTR and Harry Potter wikis. That
// was correct and it was the wrong place to look: the content is in tables inside film
// articles, not in a category. Re-measured 10.09 over 14 sampled pages per wiki:
//
//   jamesbond                 6 pages with a locations table, ~70 rows
//   lotr                      2 pages, 24 rows
//   harrypotter               0
//   marvelcinematicuniverse   0
//   breakingbad               0
//   twinpeaks                 0
//
// **Re-measured 11.09, and the zeros above were this parser's, not Fandom's.** Across 48
// pages on six wikis, 26 carry a filming section — but only 4 keep it as a TABLE, which is
// all the parser could read. Ten look like lists and twelve are prose; and of the ten, most
// are a single bullet holding an entire paragraph. Lists are read now (`parseLocationList`)
// under a heading that says the places are real; prose is not, because prose needs a model
// per page and that is a different pass with a different cost.
//
// So this is **hundreds of rows, not thousands**, concentrated on a few wikis. It is worth
// having because of WHAT it is rather than how much: a table mapping the place in the
// STORY to the place the camera stood — "SIS Building, MI6 Headquarters" → "Somerset
// House in the Strand" — which is the `narrative_location` ↔ filming pair we hold almost
// nothing of. It is not a second MovieMaps and must not be planned for as one.

import { normalizeWorkTitle } from "./content-graph.mjs";

export const SOURCE = "fandom";

// ---------- what we may take at all ----------

// The site licence covers TEXT. Images are an absolute block regardless of it: they are
// overwhelmingly studio material under an unstructured fair-use claim by an anonymous
// uploader, and unlike Wikimedia there is no per-file metadata to check. Nothing in this
// module reads an image.
//
// Non-commercial wikis are refused outright — memory-alpha is CC-BY-NC and minecraft is
// CC BY-NC-SA. The check reads the licence TEXT and the licence URL and requires them to
// agree, because on its own example the obvious advice fails: Minecraft declares
// `CC BY-NC-SA` in the text while pointing at the farm-default CC-BY-SA url. Disagreement
// means stop.
export function licenceAllows({ text, url } = {}) {
  const both = `${text ?? ""} ${url ?? ""}`.toLowerCase();
  if (!String(text ?? "").trim() && !String(url ?? "").trim()) return false;
  // "nc" as a licence component, not as a substring of another word.
  if (/\bnc\b|noncommercial|non-commercial/.test(both)) return false;
  if (/\bnd\b|noderiv/.test(both)) return false;
  return /cc[- ]by|creative ?commons/.test(both);
}

// ---------- finding the table ----------

const SECTION = /^==+\s*(?:Filming locations?|Locations?|Shooting locations?|Filming|Production)\s*==+\s*$/i;

// The section a locations table lives in — chosen by what it CONTAINS, not by which
// heading comes first.
//
// The Bond pages have both a prose `===Filming===` section and a `==Locations==` table,
// and Filming comes first. Taking the first match read three paragraphs about a script
// and returned no rows for the page with the best table on the wiki.
export function locationSection(wikitext) {
  const lines = String(wikitext ?? "").split("\n");
  const found = [];
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^(=+)\s*(.*?)\s*\1\s*$/.exec(lines[i]);
    if (!heading) continue;
    // Ends at the next heading of the same level or shallower — a subsection belongs to it.
    if (open && heading[1].length <= open.depth) {
      found.push({ ...open, text: lines.slice(open.start, i).join("\n") });
      open = null;
    }
    if (SECTION.test(lines[i])) {
      // A matching heading nested inside another closes it rather than replacing it.
      // "== Locations" holds the table and "=== Shooting locations" sits underneath it
      // holding prose; overwriting lost the table on every page shaped that way.
      if (open) found.push({ ...open, text: lines.slice(open.start, i).join("\n") });
      open = { start: i + 1, depth: heading[1].length, title: heading[2] };
    }
  }
  if (open) found.push({ ...open, text: lines.slice(open.start).join("\n") });
  if (!found.length) return null;

  // A section with a table beats one without, and one with a list beats plain prose;
  // among equals the more specific heading wins, so a bare "Filming" never shadows
  // "Filming locations".
  const rank = (s) => (s.text.includes("{|") ? 0 : (/^\s*\*/m.test(s.text) ? 5 : 10))
    + (/locations?$/i.test(s.title) ? 0 : 1)
    + (/^production$/i.test(s.title) ? 2 : 0);
  found.sort((a, b) => rank(a) - rank(b));
  // The TITLE comes back with the text, because a list can only be read when the heading
  // says the places in it are real ones — see `parseLocationList`.
  return { title: found[0].title, text: found[0].text };
}

// ---------- what each column means ----------

// Column headers are the only reliable thing here: three wikis produce three different
// tables and NONE of them agree on order.
//
//   ! Country and region !! Location !! Real/shooting Location        (Bond, 3 columns)
//   ! In-Film Locations !! Shooting Locations                          (Bond, 2 columns)
//   ! Fictional Location !! Specific Location in New Zealand !! ...    (LOTR)
//
// Reading by position would put a fictional place into the real column on two of the three.
export function classifyHeader(text) {
  const clean = String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\|/g, " ")
    .replace(/[_'"]/g, " ")
    .toLowerCase()
    .trim();
  if (!clean) return null;

  // Order matters twice over.
  //
  // "Real/shooting Location" contains "location", so the real test runs first or every
  // column answers "story". And "General Area in New Zealand" contains "in New Zealand",
  // so the AREA test must run before the qualifier test or a region is read as a place.
  if (/real|shoot|filming|filmed|actual|on ?location/.test(clean)) return "real";

  // A region column belongs to ONE side and the header is the only thing that says which.
  // In the Bond tables "Country and region" is where the SCENE IS SET — the row reading
  // "Russia" is the one whose shooting location is an altiport in France. Handing that to
  // a geocoder as the area would send it to the wrong country, so a region is only usable
  // as a real-world hint when its header ties it to a real place.
  if (/general area|\barea\b|country|region|county|state\b|province/.test(clean)) {
    return /\bin (new zealand|england|scotland|wales|ireland|iceland|morocco|australia|canada|the uk)\b/.test(clean)
      ? "real_region"
      : "story_region";
  }

  // "Specific Location in New Zealand" — a place qualified by a real country is a real
  // place, and the LOTR table has no other marker.
  if (/\bspecific\b.*\bin\b|\bin (new zealand|england|scotland|ireland|iceland|morocco)\b/.test(clean)) {
    return "real";
  }
  if (/fictional|in-?film|in the film|story|scene|depicted/.test(clean)) return "story";
  if (/^locations?$/.test(clean)) return "story";
  return null;
}

// ---------- reading the cells ----------

// A cell that answers the question without naming a place. These are frequent in the Bond
// tables and every one of them would otherwise become a pin: "Same" means the row above,
// "TBA" means nobody knows yet, and a lone dash means the column does not apply. None of
// them is an address, and inventing one from "Same" would attach the previous row's
// location to a different scene.
const NOT_A_PLACE = /^(same|same as above|ditto|tba|tbd|n\/?a|none|unknown|unspecified|\?+|-+|—+|various|multiple)$/i;

export function namesAPlace(value) {
  const text = String(value ?? "").trim();
  if (!text || NOT_A_PLACE.test(text)) return false;
  // "Same (currently known as The O2 Arena)" still means the row above. An exact match
  // alone misses every one that carries a parenthetical, and there are several.
  if (/^(same|ditto)\b/i.test(text)) return false;
  // A fragment left behind by splitting a cell — "currently known as X" is a remark about
  // the place before it, not a second place.
  if (/^(currently|formerly|now|previously|also|later)\b/i.test(text)) return false;
  // A cell that is only a parenthetical is a remark about the place beside it, not a place.
  // Shipped once: "CMGN Building Saigon in Tomorrow Never Dies was filmed at (sometimes
  // misidentified as Banyan Tree Bangkok, Sathorn)" — the wiki's aside, promoted to an
  // address because the real name sat in a sibling cell.
  if (/^\(/.test(text)) return false;
  // Needs a letter, and needs to be a name rather than a sentence about the shoot.
  if (!/[a-z]/i.test(text)) return false;
  // "some interior shots are studio" — a remark, not an address. A place name does not
  // start with a verb phrase like this, and 12 words is well past any real address.
  if (text.split(/\s+/).length > 12) return false;
  if (/^(some|most|all|several|the rest|parts?)\b/i.test(text)) return false;
  return true;
}

function stripMarkup(value) {
  return String(value ?? "")
    // Keep the reference targets before dropping the tags; the caller wants them.
    .replace(/<ref[^>]*\/>/gi, " ")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
    .replace(/<br\s*\/?>/gi, "; ")
    .replace(/<[^>]+>/g, " ")
    // [[Target|Shown]] and [[Target]]
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    // [http://x Shown] -> Shown; a bare [http://x] is a citation, not a name
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/\[https?:\/\/\S+\]/g, " ")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/'{2,}/g, "")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/^[\s;,.*–—-]+|[\s;,.*–—-]+$/g, "")
    .trim();
}

// Every external link inside a cell, which is the citation the fan actually left. On the
// Bond tables these point at movie-locations.com and commanderbond.net — an independent
// source, carried on the row rather than left for a reviewer to go and find.
//
// Measured: 3 refs across 70 Bond rows. So most rows have none, and the field is empty far
// more often than not. It is carried because when it IS there it is the difference between
// a name and a checkable claim.
export function cellReferences(value) {
  const text = String(value ?? "");
  const urls = new Set();
  for (const match of text.matchAll(/https?:\/\/[^\s\]|<}]+/g)) {
    urls.add(match[0].replace(/[.,;)]+$/, ""));
  }
  return [...urls];
}

// A cell may hold a bullet list rather than one place — the Skyfall table is two columns
// of them. Split so each place becomes its own row instead of one row naming seven cities.
function cellValues(raw) {
  // Entities are decoded FIRST. Splitting on ";" before decoding cuts "&mdash;" in half
  // and leaves "Pinewood Studios &mdash" as a place name.
  const decoded = String(raw ?? "")
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  const parts = decoded
    .split(/\n\s*\*+|<br\s*\/?>|;\s*(?=[A-Z\[])/i)
    .map(stripMarkup)
    .filter(Boolean);
  return parts.length ? parts : [];
}

// ---------- the table ----------

// Cells of one table row, each carrying its own rowspan so the grid above can carry it
// down. `style="..." | value` puts attributes before the last single pipe.
function splitRowCells(row) {
  const raw = [];
  for (const line of row.split("\n")) {
    if (/^\s*[|!]-/.test(line)) continue;
    const body = /^\s*[|!](?![|!-])(.*)$/s.exec(line);
    if (!body) {
      if (raw.length) raw[raw.length - 1] += `\n${line}`;
      continue;
    }
    for (const piece of body[1].split(/\|\||!!/)) raw.push(piece);
  }
  return raw.map((cell) => {
    const at = cell.indexOf("|");
    const looksLikeAttributes = at !== -1
      && /^[^|]*(?:=|align|style|colspan|rowspan|bgcolor|scope)/i.test(cell.slice(0, at));
    const attributes = looksLikeAttributes ? cell.slice(0, at) : "";
    const span = /rowspan\s*=\s*"?(\d+)"?/i.exec(attributes);
    return {
      text: looksLikeAttributes ? cell.slice(at + 1) : cell,
      rowspan: span ? Math.min(Number(span[1]), 50) : 1,
    };
  });
}

// Rows of { story, real, region, references }, or [] when this table cannot be read.
//
// **The guardrail: no `real` column, no rows.** A table we cannot find the shooting
// location in is a table whose cells we would be guessing at, and a guess here is a claim
// that somebody filmed somewhere they did not. Two of the four sampled tables would be
// read wrong by position alone.
export function parseLocationTable(sectionText) {
  const text = String(sectionText ?? "");
  const open = text.indexOf("{|");
  if (open === -1) return [];
  const close = text.indexOf("|}", open);
  const table = text.slice(open, close === -1 ? undefined : close);

  const chunks = table.split(/\n\s*\|-/);
  let columns = null;
  const dataChunks = [];
  for (const chunk of chunks) {
    const isHeader = /^\s*!/m.test(chunk) && !/^\s*\|(?!\|)/m.test(chunk.replace(/^\s*!.*$/gm, ""));
    if (!columns && isHeader) {
      columns = splitRowCells(chunk).map((c) => classifyHeader(stripMarkup(c.text)));
      continue;
    }
    if (isHeader) continue; // a repeated header mid-table is not data
    dataChunks.push(chunk);
  }
  if (!columns || !columns.includes("real")) return [];

  const realAt = columns.indexOf("real");
  const storyAt = columns.indexOf("story");
  const realRegionAt = columns.indexOf("real_region");
  const storyRegionAt = columns.indexOf("story_region");

  // `rowspan` is why a naive read loses rows. The Bond tables give the country one cell
  // spanning three rows, so the next two rows arrive with fewer cells and every column
  // after the gap shifts left — silently turning a story location into a real one. The
  // grid below carries a spanning cell down for as long as it claims.
  const pending = new Map();
  const rows = [];
  for (const chunk of dataChunks) {
    const cells = splitRowCells(chunk);
    if (!cells.length) continue;

    const line = [];
    let next = 0;
    for (let column = 0; column < columns.length; column += 1) {
      const carried = pending.get(column);
      if (carried && carried.left > 0) {
        line[column] = carried.text;
        carried.left -= 1;
        if (carried.left === 0) pending.delete(column);
        continue;
      }
      const cell = cells[next];
      next += 1;
      if (!cell) continue;
      line[column] = cell.text;
      if (cell.rowspan > 1) pending.set(column, { text: cell.text, left: cell.rowspan - 1 });
    }

    const rawReal = line[realAt];
    if (rawReal === undefined) continue;
    const reals = cellValues(rawReal).filter(namesAPlace);
    if (!reals.length) continue;

    const storyValues = storyAt === -1 ? [] : cellValues(line[storyAt]).filter(namesAPlace);
    // **Two lists side by side are not pairs.** The Skyfall table is one row holding a
    // bullet list of in-film locations beside a bullet list of shooting locations, in no
    // particular order and of different lengths. Zipping them produced "Istanbul, Turkey
    // was filmed at Pinewood Studios", which nobody claimed. When both sides are lists the
    // real locations are kept and the pairing is dropped, because the pairing is the part
    // we would be inventing.
    // Pairing turns on the STORY side alone, and the four cases are not symmetric:
    //
    //   one story, one real     → a pair
    //   one story, many reals   → a pair. Oxford University was shot at Brasenose College
    //                             AND on Holywell Street; both are that scene.
    //   many stories, one real  → NOT a pair. Skyfall lists seven in-film locations beside
    //                             Pinewood, and taking the first pairs Istanbul with a
    //                             soundstage — a claim nobody made.
    //   many stories, many      → NOT a pair, for the same reason.
    const paired = storyValues.length === 1;
    const story = paired ? (storyValues[0] ?? null) : null;
    const region = realRegionAt === -1
      ? null
      : (cellValues(line[realRegionAt]).filter(namesAPlace)[0] ?? null);
    // Kept apart from `region` and never used to locate anything: it is the country the
    // STORY is set in.
    const storyRegion = storyRegionAt === -1
      ? null
      : (cellValues(line[storyRegionAt]).filter(namesAPlace)[0] ?? null);
    const references = [...new Set(
      cellReferences(rawReal).concat(storyAt === -1 ? [] : cellReferences(line[storyAt])),
    )];
    for (const real of reals) rows.push({ real, story, region, storyRegion, references });
  }
  return rows;
}

// ---------- the list ----------

// A heading that promises the places under it are REAL ones.
//
// This is the whole safety of reading a list. A table is safe because a column header says
// which side is which; a bare list has no such marker, so the heading is the only thing
// that can say it. **On a fan wiki "Locations" overwhelmingly means in-universe places** —
// the Star Wars wiki's locations are Tatooine and Hoth, Game of Thrones' are Winterfell —
// and a map that a reader walks cannot hold them. So "Filming locations" is read and a
// bare "Locations" is refused, which is the same rule the table parser already follows
// when it cannot identify a shooting column.
const REAL_PLACES_HEADING = /film(ing|ed)|shoot(ing)?|on location/i;

// A bullet holding a PARAGRAPH is not a list item, and this is the common case rather than
// the edge. Measured 11.09 on the sections that a leading "*" made look like lists:
//
//   jamesbond / Skyfall            one bullet, 800+ characters of prose about road closures
//   gameofthrones / Driftmark      one bullet, a paragraph naming St Michael's Mount inside it
//   lotr / Halifirien              five bullets, one place each — the shape this can read
//
// Taking the first two as place names would hand a geocoder an entire paragraph. Prose
// like that is readable, but only by a model, and that is a different pass with a
// different cost — not something to fake here by taking the first 60 characters.
const MAX_PLACE_LENGTH = 120;

export function namesAPlaceInAList(value) {
  const text = String(value ?? "").trim();
  if (!namesAPlace(text)) return false;
  if (text.length > MAX_PLACE_LENGTH) return false;
  // A sentence, not a name: "Shooting began in and around London, with scenes shot in…".
  //
  // **The full stop alone cannot decide it**, and the first attempt got this wrong: place
  // names are full of abbreviations, and "Keash Mountain, Ballymote, Co. Sligo" was refused
  // because ". S" looked like the start of a sentence. So the word BEFORE the stop has to
  // be a real word — four letters or more — which keeps Co., St., Mt. and Rd. and still
  // catches "…closed for filming. Photos taken by residents…".
  if (/\b[A-Za-z]{4,}[.!?]\s+[A-Z]/.test(text)) return false;
  // And a predicate, because a long clause can run on without a full stop at all.
  if (/\b(was|were|is|are|been|began|begun|shot|filmed|took|taken|used|doubles?|doubled|serves?|stood|built|closed|reported|features?)\b/i.test(text)) return false;
  // A bare external link — "[http://imdb.com/… Halifirien on IMDB]" sits in the middle of
  // the Halifirien list and names no place at all.
  if (/^(https?:\/\/|\[https?:)/i.test(text)) return false;
  if (/\bon (imdb|youtube|facebook|twitter)\b/i.test(text)) return false;
  return true;
}

// Real-world places from a bullet list, or nothing.
//
// Every row comes back unpaired — `story` is null — and that is deliberate. A table says
// which column is the story and which is the shoot; a list says nothing, and an item like
// "Istanbul, Turkey – Pinewood Studios" could be read either way round. The table parser
// already refuses to invent a pairing when it cannot be sure ("two lists side by side are
// not pairs"); this is the same refusal, and the real location is still worth having
// without it.
export function parseLocationList(sectionText, { title = "" } = {}) {
  if (!REAL_PLACES_HEADING.test(String(title ?? ""))) return [];
  const text = String(sectionText ?? "");
  // Top-level bullets only. A nested "**" is a qualifier on its parent, not a second place.
  const items = text.split("\n").filter((line) => /^\*(?!\*)/.test(line));

  const rows = [];
  for (const item of items) {
    const raw = item.replace(/^\*\s*/, "");
    for (const value of cellValues(raw)) {
      if (!namesAPlaceInAList(value)) continue;
      rows.push({ real: value, story: null, region: null, storyRegion: null, references: cellReferences(raw) });
    }
  }
  return rows;
}

// The rows a section yields, whichever shape it keeps them in. The table is tried first
// because it carries the pairing, which is the part worth the most and the part a list
// cannot give.
export function parseLocationRows(section) {
  const { title = "", text = "" } = typeof section === "string" ? { text: section } : (section ?? {});
  const table = parseLocationTable(text);
  return table.length ? table : parseLocationList(text, { title });
}

// ---------- what a row becomes ----------

// The sentence a card prints. It states WHO said it and WHERE, because that is the whole
// difference between this and a fact: a named wiki page at a named revision, which anybody
// can open and read for themselves.
export function fandomSentence({ real, story, region, storyRegion }, { workTitle, wiki, page }) {
  // The region is appended to the REAL place only when the table tied it to one. Writing
  // "filmed at <altiport>, Russia" because the scene is set in Russia would assert the
  // altiport is Russian; it is in France.
  const where = [real, region].filter(Boolean).join(", ");
  const set = [story, storyRegion].filter(Boolean).join(", ");
  const head = set
    // The pair that makes this source worth having at all.
    ? `${set} in ${workTitle} was filmed at ${where}`
    : `${workTitle} was filmed at ${where}`;
  return `${head} — according to the ${wiki} wiki page "${page}".`;
}

// A queue row, never a fact.
//
// `place_key` is NOT set here: the column is generated as `lower(btrim(place_name))` and
// the table's unique index is (work_id, place_key), so the database decides identity and
// a re-run updates rather than duplicates. One consequence worth knowing — two scenes of
// one film shot at the same address are ONE row, and the later sentence wins.
export function toSubmission(row, { work, wiki, page, revid, licence }) {
  const name = String(row?.real ?? "").trim();
  if (!name || !work?.id) return null;
  // A cell that is a sentence rather than a name is left for the geocoder's own rule to
  // refuse; what is refused HERE is a cell that names nothing at all.
  if (!/[a-z]/i.test(name)) return null;

  const permalink = `https://${wiki}.fandom.com/wiki/${encodeURIComponent(String(page).replace(/ /g, "_"))}`
    + (revid ? `?oldid=${revid}` : "");

  return {
    work_id: work.id,
    place_name: name,
    area_hint: row.region ?? null,
    source_kind: SOURCE,
    // NOT NULL on the table. It names what a reader is being sent to, and "the wiki page"
    // is the honest description — the link goes to one revision of one fan-written page.
    source_title: `${wiki} wiki: ${page}`,
    // NOT NULL, and the schema is right to insist. The licence is the reason this row may
    // exist at all, so it belongs in a column of its own rather than in a note — and a
    // wiki whose licence could not be read never reaches here (see `licenceAllows`).
    source_license: String(licence ?? "").trim() || "unknown",
    // The revision, not the live page. A fan wiki changes under you, and a citation that
    // cannot be re-read is not a citation.
    source_url: permalink,
    // In a column of its own, not only inside that URL. The table's evidence constraint
    // requires it for this source exactly as it does for Wikipedia — a revision no query
    // can reach is not evidence the review process can use.
    source_revid: Number(revid) > 0 ? Number(revid) : null,
    source_sentence: fandomSentence(row, { workTitle: work.title, wiki, page }),
    status: "pending",
    // No coordinate. Fandom has none, and a point invented during an import is a guess
    // buried where nobody looks — the same rule movie-locations is ingested under.
    lat: null,
    lng: null,
    // Kept so a reviewer can see the licence the text arrived under and the independent
    // sources the fan cited, without re-fetching the page.
    // The independent sources the fan cited, kept where a reviewer sees them without
    // re-fetching the page. The licence is NOT repeated here — it has its own column.
    status_reason: row.references?.length
      ? `cites: ${row.references.slice(0, 3).join(" ")}`
      : null,
  };
}

// Title → work, by the catalogue's own normaliser. A film page is usually "Skyfall (film)"
// and the catalogue holds "Skyfall", so the qualifier comes off before matching.
export function pageTitleToWorkTitle(page) {
  return String(page ?? "").replace(/\s*\((film|movie|\d{4} film|novel|book)\)\s*$/i, "").trim();
}

export function matchWork(page, worksByTitle) {
  const key = normalizeWorkTitle(pageTitleToWorkTitle(page));
  const hits = worksByTitle.get(key) ?? [];
  // One candidate or nothing. Two works sharing a title is exactly the collision the year
  // backfill was for, and a wiki page carries no year to break the tie with.
  return hits.length === 1 ? hits[0] : null;
}
