# Handoff — 2026-08-05 (updated after the wiring session)

Written because a session ended, not because the work did. Read `wiki/log.md` for the
chronicle and `wiki/index.md` for the concept pages. **This page is only the things that
would cost a day to rediscover.**

## The product, in one paragraph

GloryMap replaces the film-location tours operators sell — the Game of Thrones coach in
Antrim, the Harry Potter walk in Edinburgh. That makes the deliverable **a route
somebody walks**, not a database of pins, and it widens what counts as a place: not only
where a work was filmed, but where it was **written or made** — the café Rowling wrote
in, the graveyard she took a name from. Every pin is source-backed and never invented.

## What is built and NOT wired up — read this first

This project's most repeated failure is finished, correct work that never reaches the
live path. It has happened with posters, ratings, three audio features, the personal
library and the map filter.

**The three modules that were in that state are now wired** (`a7b8ba0`, `bbf4f7a`,
`d962a03`) — check before assuming otherwise:

| module | reaches the user through | what to check first |
|---|---|---|
| `place-search.mjs` | `inverted-places.mjs` → `/api/locations?q=` → hollow pins | ordering of the fan-out: six branches is the whole budget |
| `place-access.mjs` | `POST /api/access` → `timed-tour.mjs` → per-stop notes | OSM coverage is ~1 in 3 and city-biased |
| `place-grade.mjs` | `/api/locations` grades every place → dashed areas | a place with no readable type stays a pin |

Nothing new is sitting unwired as of this session. **Before writing a module, grep for
its callers** — `grep -rn "from .*<module>" app/` — and if the answer is zero, wire it.

## Traps that cost real time, all found by measurement

**Four services report failure inside a success.** Check before parsing, always:
- OpenRouter `/v1/responses` returns HTTP 200, `status: "completed"`, and **silently
  ignores the JSON schema** — use `chat/completions` with `response_format`.
- Wikimedia answers a missing page AND a lagged replica with HTTP 200 and an error body.
- Overpass answers "the server is probably too busy" with HTTP 200 and an HTML page.
- CirrusSearch `insource:/A/ OR insource:/B/` returns **zero results, not an error**. The
  alternation must go inside one regex: `insource:/A|B/`.

**A name in an Overpass query is not enough.** A union of `around` statements returns
ONE result set, so an element fetched for another point is still in the list — and the
nearest named feature to a place is routinely not the place (Greyfriars' is a gravestone
8 m away, Alnwick Castle's is the Diana Gift Shop). Re-check the name on the way out,
with EXACT normalized equality: `namesMatch` accepts one extra word, which is right for
merging two records of one place and turns "Notting Hill Bookshop" into Notting Hill here.

**A Wikidata item can have no English label.** Q34660 — J. K. Rowling — has labels in
dozens of languages and none in English today, so the label service returns the bare
q-id. Fall back to the English Wikipedia sitelink title.

**`insource:"X"` and `insource:/X/` are different operators.** The quoted form matches
tokens and misses "Rowling's". The regex form is the one that works.

**`Number("")` is 0 and 0 is finite.** This has put places at Null Island four times.
`finiteOrNull` in `numbers.mjs` exists for it; its own test caught it again this session.

**Never run `next build` while the dev server is up** — it clobbers `.next` and the page
goes blank. Check `lsof -ti:3000` first. I did this three times.

**Do not guess Q-ids.** I have resolved to the wrong entity three times (Batman Begins,
The Last Emperor, Sherlock-the-character). Query by title and year.

## Refused sources — settled, do not re-research

- **IMDb** — scraping prohibited AND it does not own most photos, so there is nobody to
  buy rights from.
- **Fandom** — per-wiki licence roulette including CC-BY-NC; the "Filming locations"
  categories are EMPTY on the Bond, LOTR and Potter wikis; claims are anonymous.
- **Film-Grab / Movie-Screencaps / ShotDeck** — real frames, no rights to grant.
- **MovieMaps, Doctor Who Locations Guide, Reelstreets** — terms forbid it.

**But looking is not ingesting.** Their stop lists are legitimate as *leads* (verify the
claim in our own sources) and as a *recall benchmark*. Measured: operators visit 47
Edinburgh Harry Potter stops; we cover 8.

## Keys and secrets

`.env.local` holds `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`,
`SCENE_MATCH_SIGNING_SECRET` and the two public Supabase values.

- **`SUPABASE_SERVICE_ROLE_KEY` was printed to a terminal and appeared in a screenshot
  shared into a chat. Rotation was recommended and I never confirmed it happened.**
- `SCENE_MATCH_SIGNING_SECRET` is set in `.env.local` and in Vercel production+preview.
  Development failed to set and was not retried. Its fallback to `OPENAI_API_KEY` was
  removed, so it is now required.
- OpenAI is only needed for `/api/narration` (TTS). OpenRouter has no speech endpoint.
- Free tier: 20 requests/minute, 50/day, rising to 1000/day after $10 of lifetime credit.
  The batch and the interactive routes share one bucket.

## State of the data

15 works · 70 places · 92 links (**8 with no evidence — see `links_without_evidence`**)
· 56 pending submissions, 30 with coordinates, 10 of them from Paris permits.

Nothing in `location_submissions` has been reviewed. There is no review UI.

## Next, in the order I would take it

1. **Turn inverted-search candidates into claims.** They arrive as candidates — a hollow
   pin saying "this place's article mentions the work" — and that is honest but thin.
   A quoted sentence checked verbatim is the next step, and the machinery is in
   `wikipedia-extract.mjs`. The relation it should produce is usually `inspiration_for`
   or `author_place`, both of which the schema now has.
2. **Decide the access rule.** Measured coverage is 4 of 12, city-biased. Today an
   unconfirmed stop is routed to WITH a warning; the module's own argument says not
   knowing should stop the route. That is the operator's call, and it is one constant
   plus one filter (`isRoutable` in `createTimedTourCandidates`) away either direction.
   Better coverage would settle it: OSM opening hours, Wikidata P1656/P8626, or the
   attraction's own page.
3. **Order stops by story, not distance.** `story-trail.mjs` already has
   `sequence_index`; `timed-tour.mjs` uses `nearestNeighborOrder` and ignores it.
4. **Leg mode** — walk / transit / drive. `timed-tour` is hard-coded to 30/60/120 minutes
   on foot and cannot express any real tour.
5. A review UI for the queue.

## Known-wrong, unfixed

- The inverted search returns some **non-places with coordinates** — "Eurovision Young
  Musicians 2018" comes back for Harry Potter in Edinburgh. It is labelled unverified
  and it is still noise; an event is not a place.
- A one-word title (**"Dracula"**, "Trainspotting") contributes nothing to the inverted
  search — `isSearchableEntity` needs two words — so such a work depends entirely on its
  fan-out, and a work with no characters in Wikidata gets no candidates at all.
- Searching **"Skyfall" resolves to Adele's lyric video** (Q57840000), not the film.
- The 500km search takes **3.7 seconds**.
- Zoom-triggered refetch was verified by code and API, **not through the browser** — the
  automation stalled and I never got a clean UI confirmation.
- `api_help.html` and `lt.html` are research scratch in the repo root, untracked.

## How to work here

Repo in English; **GitHub issues in Russian**. No Claude attribution anywhere — history
was rewritten and `includeCoAuthoredBy: false`; this overrides the `/ship` template's
trailer. Tests are `node --test test/*.test.mjs`, zero-network, dependency-injected.
Answers to the operator are written as ready-to-paste prompts for their team.
