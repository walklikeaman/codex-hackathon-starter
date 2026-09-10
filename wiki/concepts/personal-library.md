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

## Sorting and filtering by rating — and whose rating it can be

Measured 10.09.2026 against production, this is not a design choice:

| | |
|---|---|
| `work_ratings` | **32 rows across 12 works**, out of 7,063 |
| works with a Los Angeles row | 1,642 — of which **one** carries a rating |
| a real Letterboxd export | **2,407 ratings for 2,422 films** |

**So "sort by rating" can only mean the reader's own.** Ordering by a public score would
sort 1,641 of the 1,642 Los Angeles films by a field that is null. The rating was already
parsed and merged (`ratings.csv` + `watched.csv`) and already shown in the My-movies panel;
nothing on the map had ever read it.

That has a consequence: **all of it is decided in the browser.** The library never reaches
the server, so no endpoint can order by it. The server hands over what is in the viewport
and [app/lib/library-view.mjs](../../app/lib/library-view.mjs) decides what is shown and in
what order. The candidate pins use **the same predicate** as the chips — a panel counting
one set while the map drew another is the "header contradicting the thing it heads" bug
[[place-card]] already fixed once for the viewport count.

Four rules worth keeping:

- **Unrated is null, never zero.** Watched-and-never-scored is not the same as bad. Sorted
  as a 0 it would sit below a film the reader actively disliked, which says something they
  did not; it sinks below every rated film instead.
- **A minimum rating implies "my list only"**, because it cannot mean anything else — and
  without saying so it would silently drop every film not in the library, which is most of
  the map, and read as an outage. The control says it out loud.
- **Every sort falls through to the title.** Ties are the normal case, not the edge: 3.5★
  is the most common score in a real export and 39.8% of works hold exactly one place.
  Without a final key the list reshuffles between renders.
- **The default order is "how much we hold"**, not anybody's opinion. A stranger with no
  library gets what there is to go and see; the rating option is not offered until there is
  a library to read it from.

## The year, and why two of them can both be right

The matcher pairs a catalogue work with a library row on a normalised title **and** a year,
where a year missing on either side counts as agreement. Measured 10.09.2026 that made the
match title-only for **6,041 of 7,063 works**, and the collisions were real: the reader's
1984 *Ghostbusters* was matching the catalogue's 2016 one, and their 2009 *Star Trek* was
matching the 1966 series.

**6,038 of those 6,041 carry an IMDb id**, and only 12 carry a TMDB id — so the IMDb id is
the key we actually have. On the same 30 works, TMDB's `find` answered **28** and
Wikidata's P345 → P577 answered **19**, which settled the source.
[scripts/backfill-work-years.mjs](../../scripts/backfill-work-years.mjs). IMDb itself is
never read — their terms forbid extracting it ([[source-evaluation]]) and the id is used
only as a lookup key.

**The measurement that changed the design.** 298 backfilled years compared against the same
reader's own export:

| | | |
|---|---|---|
| exact | 266 | 89.3% |
| **off by one** | 9 | 3.0% — Kingsman 2014/2015, Reservoir Dogs 1991/1992, V for Vendetta 2005/2006, Split 2016/2017 |
| **off by two or more** | 24 | 8.1% — Star Trek 2009/1966, A Star Is Born 2018/1937, Ghostbusters 1984/2016 |

Those two rows are different things. **Off by one is one film with two true dates** —
Letterboxd dates a film by its first public showing and TMDB by its primary release, and a
festival film differs by a year with neither side wrong. **Off by two or more is a
different film**: a remake, a reboot, or the series of the same name — precisely the
collision the year was added to stop.

So `YEAR_TOLERANCE` is **one year**: wide enough to hold a premiere and its release
together, narrow enough to keep 1984's *Ghostbusters* away from 2016's. It costs about one
case in three hundred — *The Evil Dead* premiered in 1981 and was released in 1983, and two
years apart it reads as two films. Widening to two would fix that one and re-merge four
genuinely different films with it, which is the worse trade.

**A year we write must not be worse than the null it replaces**, and it can be: a null makes
the match loose, a wrong year makes it fail. That is why the backfill writes TMDB's primary
release date and nothing else — no guessing from a title, no averaging across regions — and
the tolerance lives in the client rather than the data pretending to a precision it lacks.

## Gotchas

- A record from Letterboxd (no imdbId) and one from IMDb (with imdbId) will NOT merge into one.
- A ZIP with a nested folder isn't recognized — watched.csv is looked for strictly at the root.
- The year "matches" if it's missing on at least one side — false matches
  of same-titled films are possible.

## Next (ideas, not in progress)

Sign in by nickname without files — Letterboxd RSS (ready-made tmdb-ID!), Trakt, Kinopoisk,
MyShows, Goodreads RSS: the full matrix — [[personal-collections-matrix]].
Owner's decision 22.07: ideas only for now.
