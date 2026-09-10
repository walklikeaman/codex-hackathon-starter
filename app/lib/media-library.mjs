import { normalizeWorkTitle } from "./content-graph.mjs";

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function cleanHeader(value) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function firstValue(record, aliases) {
  for (const alias of aliases) {
    const value = record[alias]?.trim();
    if (value) return value;
  }
  return null;
}

function numberValue(value) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function libraryKey(movie) {
  return movie.imdbId || `${movie.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${movie.year ?? ""}`;
}

// The SAME normaliser the catalogue's `title_norm` is built with, imported rather than
// re-implemented. The two used to differ by one line and it silently broke every accented
// title: this one lacked the combining-accent strip, so NFKD turned "Amelie" into
// "ame\u0301lie" and the punctuation rule then made it "ame lie", against a catalogue
// holding "amelie". "Léon: The Professional" failed the same way. A library of 2,422 films
// matched nothing it should have.
const normalizedTitle = normalizeWorkTitle;

// Exported so a test can assert the two definitions are the same one.
export { normalizeWorkTitle as normalizedTitleForTest };

// Two release years for one film, and both are right.
//
// Letterboxd dates a film by its first public showing; TMDB's `find` answers with the
// primary release date. For a festival film those are different years and neither is
// wrong — measured on 298 works whose year was backfilled from TMDB and compared against
// the same reader's own export:
//
//   exact                 266  (89.3%)
//   off by one              9  ( 3.0%)   Kingsman 2014/2015, Reservoir Dogs 1991/1992,
//                                        V for Vendetta 2005/2006, Split 2016/2017
//   off by two or more     24  ( 8.1%)   Star Trek 2009/1966, A Star Is Born 2018/1937,
//                                        Ghostbusters 1984/2016 — DIFFERENT FILMS
//
// The two groups are different things. The off-by-one rows are one film with two true
// dates; the off-by-two rows are a remake, a reboot or the series of the same name, which
// is exactly the collision the year was added to stop. So the tolerance is **one year** —
// wide enough to hold a premiere and its release together, narrow enough to keep 1984's
// Ghostbusters away from 2016's.
//
// It costs about one case in three hundred: The Evil Dead premiered in 1981 and was
// released in 1983, and two years apart it is read as two films. Widening to two would
// merge The Evil Dead correctly and re-merge four genuinely different films with it, which
// is the worse trade.
export const YEAR_TOLERANCE = 1;

// The library row behind a work, or null. `workIsInLibrary` is this question with the
// answer thrown away, and it is written once so the two can never disagree about which
// film matched — a sort that ordered by one row while the filter tested another would be
// invisible and wrong.
//
// A year missing on EITHER side still counts as agreement. That is not laxity, it is the
// only thing that can be done with a null: before the backfill 6,041 of 7,063 works had
// no year at all, and the ones still lacking one are works TMDB does not know.
export function libraryEntryFor(work, library) {
  const title = normalizedTitle(work?.title);
  if (!title) return null;
  return (Array.isArray(library) ? library : []).find((movie) =>
    normalizedTitle(movie?.title) === title
      && (!work?.year || !movie?.year || Math.abs(work.year - movie.year) <= YEAR_TOLERANCE),
  ) ?? null;
}

export function workIsInLibrary(work, library) {
  return libraryEntryFor(work, library) !== null;
}

// Letterboxd rates in half-stars, 0.5 to 5. A film in the library with no rating is
// WATCHED AND UNRATED, which is not the same as bad — so it is null, never 0, and every
// comparison below has to decide what to do with it rather than sorting it to the bottom
// by accident. Measured on a real 2,422-film export: 2,407 rated, 15 not.
export function libraryRating(work, library) {
  const rating = libraryEntryFor(work, library)?.rating;
  return Number.isFinite(rating) ? rating : null;
}

export function parseMediaCsv(text, source) {
  if (!new Set(["letterboxd", "imdb"]).has(source)) throw new Error("Unsupported media source");
  const [headerRow, ...dataRows] = parseCsvRows(text);
  if (!headerRow) throw new Error("The CSV file is empty");

  const headers = headerRow.map(cleanHeader);
  const movies = dataRows.flatMap((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    const title = firstValue(record, ["name", "title", "original title"]);
    if (!title) return [];

    const imdbId = firstValue(record, ["const", "imdb id"]);
    const rating = numberValue(firstValue(record, ["rating", "your rating"]));
    const year = numberValue(firstValue(record, ["year", "release year"]));
    const watchedDate = firstValue(record, ["watched date", "date rated", "date"]);
    const url = firstValue(record, ["letterboxd uri", "url"]);

    return [{
      id: imdbId || `${source}:${libraryKey({ title, year })}`,
      title,
      year,
      rating,
      watchedDate,
      url,
      imdbId: imdbId && /^tt\d+$/.test(imdbId) ? imdbId : null,
      sources: [source],
    }];
  });

  if (!movies.length) throw new Error("No movie titles were found in this CSV");
  return movies;
}

export function mergeLibraries(current, imported) {
  const merged = new Map(current.map((movie) => [libraryKey(movie), movie]));

  for (const movie of imported) {
    const key = libraryKey(movie);
    const previous = merged.get(key);
    merged.set(key, previous ? {
      ...previous,
      ...movie,
      rating: movie.rating ?? previous.rating,
      watchedDate: movie.watchedDate ?? previous.watchedDate,
      url: movie.url ?? previous.url,
      sources: [...new Set([...(previous.sources ?? []), ...movie.sources])],
    } : movie);
  }

  return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title));
}
