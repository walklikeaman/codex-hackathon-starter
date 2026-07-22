# Personal library — privacy as a principle

The user's "My movies": import, storage, map filtering. Implementation:
`app/lib/media-library.mjs` + `app/lib/letterboxd-archive.mjs`, UI in
[[frontend]] (the My movies panel).

## How it works today

- Import: **Letterboxd ZIP** (watched.csv + ratings.csv, archive ≤25 MB, CSV
  ≤10 MB) and **Letterboxd/IMDb CSV** (a custom parser: quotes, CRLF, BOM,
  header aliases for both services).
- Everything is parsed **in the browser**; the library lives in localStorage
  (`scenemap-library`), nothing goes to the server. A real export: 2422
  films imported, of which 3 films / 6 locations were found in the London data.
- mergeLibraries: the key is imdbId or slug(title):year; sources are merged.
- workIsInLibrary matches by normalized title (NFKD, a-z0-9) with a loose
  year comparison.
- After import, the "library on map" filter is auto-enabled.

## Gotchas

- A record from Letterboxd (no imdbId) and one from IMDb (with imdbId) will NOT merge into one.
- A ZIP with a nested folder isn't recognized — watched.csv is looked for strictly at the root.
- The year "matches" if it's missing on at least one side — false matches
  of same-titled films are possible.

## Next (ideas, not in progress)

Sign in by nickname without files — Letterboxd RSS (ready-made tmdb-ID!), Trakt, Kinopoisk,
MyShows, Goodreads RSS: the full matrix — [[personal-collections-matrix]].
Owner's decision 22.07: ideas only for now.
