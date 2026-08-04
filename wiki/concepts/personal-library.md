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
- **No account is needed for any of it.** Import, storage and the map filter are all
  client-side; signing in adds cloud sync across devices and nothing else.

## The feature existed for weeks and could not be reached

Both halves — the ZIP parser and the map filter — were finished and correct. Verified
against a real 2,422-film export: parsed in 52ms, and `workIsInLibrary` matched 8 of our
12 works, with all four misses being genuine absences rather than matching failures
("Sherlock Holmes" is rightly not "Sherlock").

What did not exist was a door. The header button read

```js
onClick={() => accountUser ? setAccountOpen(true) : signInWithProvider("google")}
```

so an anonymous visitor clicking it went straight to Google OAuth — and the import UI
and the filter both live inside that panel. A guest could neither import a list nor
filter by one, while the library is stored under `GUEST_LIBRARY_KEY`, so guest use was
always the intent.

The filter also sat in the account dialog, three clicks and an OAuth redirect away from
the map it filters. It now sits above the work chips and appears only once there is a
list to filter by, because an empty toggle is a question the visitor cannot answer.

**This was the fourth time in this project that finished, correct work was invisible
because it never reached the live path** — after posters, ratings and three audio
features. "Done" and "reachable" diverge here systematically, and planning should treat
them as separate states.

## Gotchas

- A record from Letterboxd (no imdbId) and one from IMDb (with imdbId) will NOT merge into one.
- A ZIP with a nested folder isn't recognized — watched.csv is looked for strictly at the root.
- The year "matches" if it's missing on at least one side — false matches
  of same-titled films are possible.

## Next (ideas, not in progress)

Sign in by nickname without files — Letterboxd RSS (ready-made tmdb-ID!), Trakt, Kinopoisk,
MyShows, Goodreads RSS: the full matrix — [[personal-collections-matrix]].
Owner's decision 22.07: ideas only for now.
