// Turning a title written on a wall into a work with a real identifier.
//
// The plaque ingest could only link to works we already held, and measured, that was the
// ceiling: of 853 titles named on plaques that state production, 811 were works we did
// not have. This is the other half — resolve the title in Wikidata, then create the work
// carrying its q-id from birth.
//
// EVERY RULE HERE EXISTS BECAUSE THE PREVIOUS VERSION WAS WRONG, and the wrongness was
// never obvious. Measured on the 49 candidate titles the extractor produces:
//
//   exact title + is a film/series/book        27 resolved, and 7 of them wrong
//   + the year on the wall                     18 resolved
//   + the title beside the claim               13 resolved, all correct
//
// The failures the last two rules remove are the instructive ones: "The Lady Vanishes"
// resolved to the 1976 remake although the plaque is about Gainsborough Studios
// 1924-1949; "Taj Mahal" to a 1963 film although the plaque names a hangar in San
// Antonio; "Decoration Day" to a 1990 film although the plaque is about a cemetery
// tradition. All three look right in a list and are false on the wall.

// A candidate must BE the title, not contain it: "Moby Dick" must not resolve to
// "Moby Dick's Wildest Adventure".
export function titlesMatch(a, b, normalize) {
  return Boolean(a) && Boolean(b) && normalize(a) === normalize(b);
}

// Years written on the plaque. Two of them are usually a range — "The Gainsborough Film
// Studios 1924-1949" — and the film sits inside it rather than beside either end, which
// is how The Wicked Lady (1945) was rejected while the 1983 remake was not.
export function plaqueYears(inscription) {
  return [...String(inscription ?? "").matchAll(/\b(18\d{2}|19\d{2}|20[0-2]\d)\b/g)]
    .map((match) => Number(match[1]));
}

export const YEAR_TOLERANCE = 3;

export function yearFits(workYear, years) {
  if (!workYear || !years?.length) return false;
  if (years.some((year) => Math.abs(workYear - year) <= YEAR_TOLERANCE)) return true;
  if (years.length < 2) return false;
  return workYear >= Math.min(...years) && workYear <= Math.max(...years);
}

// The verb chooses the kind. "Zane Grey, the prolific author of western novels, lived
// here … Riders of the Purple Sage" is about the NOVEL; attaching it to the 1918 film
// adaptation would have the author writing a film he never made.
export function preferredKinds(inscription) {
  const text = String(inscription ?? "");
  const wrote = /\b(wrote|written|author|novelist|poet|novels?|book)\b/i.test(text);
  const filmed = /\b(filmed|filming|film location|location for|shot here|starring)\b/i.test(text);
  if (wrote && !filmed) return ["book"];
  if (filmed && !wrote) return ["film", "series"];
  return null;
}

// Which candidate the plaque meant, or null when the plaque cannot say.
//
// The last branch is the one worth reading: with no year there is nothing to
// disambiguate WITH, so a match is only safe when there is nothing to disambiguate
// BETWEEN. One work of that exact title and kind, or none at all.
export function chooseWork(candidates, { inscription, title, normalize }) {
  const usable = (candidates ?? [])
    .filter((work) => work && work.kind && work.kind !== "other")
    .filter((work) => titlesMatch(work.label, title, normalize));
  if (!usable.length) return { work: null, why: "no film, series or book with that exact title" };

  const preferred = preferredKinds(inscription);
  const ranked = [...usable].sort((left, right) => {
    const rank = (work) => (!preferred || preferred.includes(work.kind) ? 0 : 1);
    return rank(left) - rank(right) || (right.sitelinks ?? 0) - (left.sitelinks ?? 0);
  });

  const years = plaqueYears(inscription);
  if (years.length) {
    const dated = ranked.filter((work) => yearFits(work.year, years));
    return dated.length
      ? { work: dated[0], why: null }
      : { work: null, why: `the year on the wall (${years.join("/")}) matches none of them` };
  }

  return ranked.length === 1
    ? { work: ranked[0], why: null }
    : { work: null, why: `no year on the plaque and ${ranked.length} works share the title` };
}

// A work row, built from what Wikidata said and nothing else.
export function workFromResolution(work, title) {
  if (!work?.id || !/^Q[1-9]\d*$/.test(work.id)) return null;
  return {
    wikidata_id: work.id,
    imdb_id: work.imdb ?? null,
    title,
    kind: work.kind,
    year: work.year ?? null,
    source: "open_plaques",
  };
}
