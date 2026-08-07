# Handoff — 2026-08-07, end of the wiring session

Written because a session ended, not because the work did. `wiki/log.md` is the
chronicle and `wiki/index.md` lists the concept pages. **This page is only the things
that would cost a day to rediscover.**

## The product, in one paragraph

GloryMap replaces the film-location tours operators sell — the Game of Thrones coach in
Antrim, the Harry Potter walk in Edinburgh. That makes the deliverable **a route
somebody walks**, not a database of pins, and it widens what counts as a place: not only
where a work was filmed, but where it was **written or made** — the café Rowling wrote
in, the graveyard she took a name from. Every pin is source-backed and never invented.

The owner's acceptance test for the demo, in his words: **a juror names their favourite
film, we type it in, and it is there — with no doubt that we have it.** Measured on
production: empty for **0 of 24** famous titles, median 1.3 s.

## State, in numbers (live, end of session)

| | |
|---|---|
| main | `79bf9e8` — "A title on a wall becomes a work with a real identifier (#140)", deployed and verified |
| tests | 854, `node --test test/*.test.mjs`, zero network |
| works | 7,063 · **28 with a Wikidata id** · 70 places · 92 verified links |
| queue | **44,098 submissions, 30,257 geolocated, across 6,075 works — zero reviewed** |
| by source | moviemaps 30,153 · reelstreets 8,063 · movielocations 5,783 · open_plaques 53 · wikipedia 36 · permits 10 |

**The map answers from three stores at once**, and this is the thing to understand before
touching [app/api/locations/route.js](app/api/locations/route.js):

1. **Wikidata statements** — P915 / P840, live, per work.
2. **The inverted search** — places whose OWN article mentions the work
   ([app/lib/inverted-places.mjs](app/lib/inverted-places.mjs)), live, geographic.
3. **Our queue** — `location_submissions`, bridged by IMDb id and by title
   ([app/lib/submission-places.mjs](app/lib/submission-places.mjs)). Everything from it
   arrives as a **candidate**: hollow pin, "not yet verified by us", a link to the source.
   Nothing from the queue enters `places` or the graph.

## What is built and NOT wired up

Nothing, as of this session — and that is worth keeping true. The project's most repeated
failure is finished work that never reaches the live path: it happened with posters,
ratings, three audio features, the personal library, the map filter, then all three place
modules, then the entire 30k-row ingest. **Before writing a module, grep for its callers**
(`grep -rn "from .*<module>" app/`); if the answer is zero, wire that before writing more.

## Traps that cost real time, all found by measurement

**Four services report failure inside a success.** Check the body before parsing:
OpenRouter `/v1/responses` returns 200 and silently ignores the JSON schema (use
`chat/completions` with `response_format`); Wikimedia answers a missing page and a lagged
replica with 200 and an error body; Overpass answers "the server is probably too busy"
with 200 and an HTML page; CirrusSearch `insource:/A/ OR insource:/B/` returns **zero
results rather than an error** — the alternation must live inside one regex.

**A merge into `main` does NOT reliably deploy production.** Of four merges in forty
minutes, two produced a Production deployment and two did not. Worse, the obvious check
lies: `gh api repos/…/commits/<sha>/status` goes green on the **Preview** deployment. Ask
for the environment by name, and force it when it has not fired:

```bash
gh api "repos/walklikeaman/codex-hackathon-starter/deployments?environment=Production&per_page=5" --jq "[.[] | select(.sha==\"$(git rev-parse origin/main)\")] | length"
```

```bash
gh workflow run "Deploy production" -f ref=main -f confirm_production=true
```

**The database has rules the repo does not describe.** Twice a constraint existed only in
production because another session applied it through the MCP without committing — and a
new `CHECK` was then rejected by 8,063 live rows. Read the live definition first: a
constraint is written against the database that exists, not the one in git.

**Never run `next build` while the dev server is up** — it clobbers `.next`. Check
`lsof -ti:3000`.

**`Number("")` is 0 and 0 is finite.** Four Null Island incidents. `finiteOrNull` exists
for it — and it is not enough on its own: the Open Plaques dump ships a Leeds cinema with
`latitude 0.0` and a correct longitude, which only an explicit zero check catches.

**A name is never an identifier.** `Bowie` returns a hundred Texas markers about Jim
Bowie; `namesMatch` accepted one extra word and turned "Notting Hill Bookshop" into the
district; a union of Overpass `around` statements returns ONE result set, so an element
fetched for another point is still in the list — the name has to be inside the query and
checked again on the way out.

**Do not guess Q-ids.** Query by title and year.

**`wbsearchentities` returns the wrong entity far more often than it looks.** "Skyfall"
gave Adele's lyric video and "Parasite" an academic journal. The fix that works, and is
now used in three places: take 15 candidates, rank by `wikibase:sitelinks`, and only then
check the type.

## Rules of the house

- **English everywhere — the repository AND GitHub** (owner's rule). Cyrillic survives
  only as DATA: the Russian Wikipedia section names `wikipedia-source.mjs` queries, and
  "Красная площадь" as the example proving the name normaliser keeps non-Latin alphabets.
  Merge-commit subjects on `main` from before the rule are still Russian; rewriting them
  means rewriting history, which is the owner's call.
- **No Claude attribution anywhere**; `includeCoAuthoredBy: false` overrides the `/ship`
  template's trailer.
- **The owner grants the full cycle**: open the PR, wait for checks, merge, verify
  production. Do not ask permission per step. Deleting data, rotating keys and anything
  irreversible still gets asked.
- **Collect any source and mark it unverified** rather than discarding the lead. Every
  card names who said it. `REFUSED_SOURCES` in `submission-places.mjs` is deliberately
  **empty** — that is a decision, not an oversight.
- Tests are `node --test test/*.test.mjs`, zero-network, dependency-injected.
- Answers to the operator are written as ready-to-paste prompts for their team.

## Refused sources — settled, do not re-research

- **IMDb** — scraping prohibited AND it does not own most photos.
- **Fandom** — per-wiki licence roulette; the "Filming locations" categories are EMPTY on
  the Bond, LOTR and Potter wikis; claims are anonymous.
- **Film-Grab / Movie-Screencaps / ShotDeck** — real frames, no rights to grant.
- **Doctor Who Locations Guide, Reelstreets** — their terms forbid the ACT, which does not
  depend on whether anything is sold. The 8,063 reelstreets rows already in the queue are
  shown as unverified candidates under the owner's ruling.
- **MovieMaps** — the site has **no terms page at all** (`/terms`, `/legal`, `/copyright`
  are 404). Owner's ruling: its rows may be shown as unverified candidates with a link
  back to the source.

**Licence type vs terms of use.** The project is a student demo and is not sold, so
non-commercial LICENCES (CC BY-NC, restricted model weights) are not blockers. Terms of
use are different: they forbid the act, not the profit.

## Keys and secrets

`.env.local` in the main clone holds the two public Supabase values, `OPENAI_*` and
`TMDB_API_KEY`. **It does NOT hold `SUPABASE_SERVICE_ROLE_KEY`** — writes to the queue
went through the Supabase MCP (`execute_sql`, which runs as `postgres`).

- **`SUPABASE_SERVICE_ROLE_KEY` was printed to a terminal and appeared in a screenshot
  shared into a chat. Rotation was recommended and never confirmed.**
- `SCENE_MATCH_SIGNING_SECRET` is set in `.env.local` and in Vercel production+preview.
- The Vercel CLI on this machine is logged into `nikita-8024` / team `kitpos`, NOT the
  account that owns this project (`walklikeaman1904`) — `vercel ls --scope
  walklikeaman1904` answers "scope does not exist", which reads as a missing project and
  is really a missing login. Use `gh` and the GitHub integration instead.

## One thing we cannot fix, and it is not for lack of trying

`rls_disabled_in_public` on `public.spatial_ref_sys` stays an ERROR in the Supabase
advisor. The table belongs to PostGIS and is owned by `supabase_admin`. Enabling RLS,
revoking its grants and `set role supabase_admin` were all attempted against the live
database and all changed nothing — `postgres` is not a superuser here and `dashboard_user`
cannot become one either, so the owner's own hands in the SQL editor hit the same wall.
**Practical consequence: `anon` can DELETE from the SRID registry through PostgREST.**
Only Supabase support can close it. Everything else the advisor reported — function
`search_path`, `security_invoker` on views, the policies — is fixed and committed as
`20260805013939_security_advisor_findings.sql`.

## Plaques: what was done and where the ceiling is

Two shipped pieces, both live: [app/lib/plaque-source.mjs](app/lib/plaque-source.mjs)
matches a plaque to a work we already hold, and
[app/lib/plaque-title-resolve.mjs](app/lib/plaque-title-resolve.mjs) turns a title written
on a wall into a NEW work carrying a real Wikidata id. Result: 53 plaques across 40 works,
and works with a `wikidata_id` went 15 → 28.

Three numbers to correct, because an earlier note in this project overstated them:

- **"811 unknown titles" was an artefact of a crude Title Case sweep** over inscriptions.
  Read properly, the extractor yields **49 candidate titles**, of which **13 resolve**
  safely. Do not plan volume against 811.
- Every rejection rule in `plaque-title-resolve.mjs` exists because the version without it
  was wrong in a way that looked right: "The Lady Vanishes" resolved to the 1976 remake
  though the plaque is about Gainsborough Studios 1924–1949; "Taj Mahal" to a 1963 film
  though the plaque names a hangar in San Antonio.
- **Stolpersteine and victim memorials are excluded first**, by series, organisation and
  the markers `deportiert` / `ermordet` / `Jg.`, with a test. 6,269 of the world dump are
  such plaques and 1,413 of them contain "lived here". Pulling those into a celebrity
  walking tour would be grotesque.

The remaining volume in plaques is the **person path** — 2,952 plaques about 1,479
creative people with Wikipedia links — and it is blocked on `creators` / `work_creators`
being empty.

## Next, in the order I would take it

1. **#129 — the fact architecture.** The most valuable and the most blocking. Two breaks
   are visible without writing code: `unique (work_id, place_id, relation_kind)` forbids a
   second fact of the same kind (Abbey Road is one row for twelve Beatles recordings), and
   a fact about a person is pinned to a work (Rowling's café is seven rows with the same
   evidence copied seven times, because `creator_place_links` does not exist). Everything
   below is easier afterwards.
2. **A review UI for the queue.** 30,257 geolocated rows, **zero reviewed**. Showing them
   honestly as candidates buys time; it is not a substitute for a decision per row.
3. **#125 — the person path in plaques.** Needs `creators` / `work_creators` filled, or a
   Wikidata person→works bridge. This is the next real volume lever, and it is a SOURCE
   problem, not a rules problem.
4. **#128 — music.** The owner said yes. Wikidata `P483` gives 5,464 recordings whose
   studio has a coordinate; Last.fm reads a listening history from a nickname with no
   auth. Needs `work_kind = music` and a `recorded_at` relation first.
5. **#127 — photo verification.** Ready technology covers half of it (MegaLoc MIT,
   LightGlue Apache-2.0, ALIKED BSD-3); verifying a claim rather than guessing a
   coordinate is ours. Stage 0 is a benchmark set of 30–50 places where the truth is
   known — without it every threshold is invented.

Open issues carried forward: #129, #128, #127, #125, #121, #114, #108, #107, #97, #96,
#95, #92.

## Open decisions for the owner

- **`isRoutable`**: an unconfirmed stop is currently routed with a warning rather than
  refused. Whether it should harden into a refusal is a product call, not a technical one.
- **Rotating `SUPABASE_SERVICE_ROLE_KEY`** (see above) — recommended, never confirmed.
- **Russian merge-commit subjects on `main`** — fixing them rewrites history.

## Known-wrong, unfixed

- **Coverage is thin by nature.** 78.7% of works in the queue have fewer than five places;
  39.8% have exactly one. Live sources add places to about two thirds of them.
- The inverted search returns some **non-places with coordinates** — "Eurovision Young
  Musicians 2018" for Harry Potter in Edinburgh.
- A **one-word title** ("Dracula", "Trainspotting") contributes nothing to the inverted
  search: `isSearchableEntity` needs two words, so such a work depends entirely on its
  fan-out.
- **Sherlock returns 5 places against Harry Potter's 26** — not a matching bug, a coverage
  one: the queue holds four rows for it.
- `api_help.html` and `lt.html` are research scratch in the main clone's root, untracked.
- Two other worktrees exist under `.claude/worktrees/`:
  `skype-ai-openrouter-movie-maps-bffab0` has **unmerged commits and uncommitted work**
  (leave it alone), and `youthful-lalande-fa0756` holds `claude/hackathon-prep-27a66c`.
