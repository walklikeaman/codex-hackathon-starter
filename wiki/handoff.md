# Handoff — 2026-08-19, after the search box, the directory and the place card

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
| main | `e8d783a` — "The card in two tabs (#160)", deployed and verified on Production |
| tests | 1,101, `node --test test/*.test.mjs`, zero network — **1,099 pass and 2 report `cancelled`**. Those two are in `artwork-api.test.mjs` ("Promise resolution is still pending but the event loop has already resolved"), they predate all of this week's work and they reproduce on a clean `main`: if you see 1,099/2, nothing is broken. |
| works | 7,063 · **6,392 with at least one located place** (`catalogue_index`) |
| queue | ~43,900 submissions · **90 verified, 914 rejected**, the rest pending ([[queue-review]]) |
| geocoded by us | **1,063** from the gazetteer pass; ~11,500 pending rows still have no point, most because the venue is not in Wikidata at all |
| surfaces | the map (`/`), the film card (`/work/<slug>--<uuid>`) and — since 19.08 — **the directory** (`/directory`, `/directory/films/<letter>`, `/city/<slug>`). That is all of them, and each now reaches the others: "Browse everything" on the map, "Browse the directory" on the card. |
| graph vs queue | **92 facts across 15 works** in the graph against **6,392 works** in the queue. What a reader sees on a card for the other 6,377 is a labelled candidate ([[directory]]). |

**The map answers from three stores at once**, and this is the thing to understand before
touching [app/api/locations/route.js](app/api/locations/route.js):

1. **Wikidata statements** — P915 / P840, live, per work.
2. **The inverted search** — places whose OWN article mentions the work
   ([app/lib/inverted-places.mjs](app/lib/inverted-places.mjs)), live, geographic.
3. **Our queue** — `location_submissions`, bridged by IMDb id and by title
   ([app/lib/submission-places.mjs](app/lib/submission-places.mjs)). Everything from it
   arrives as a **candidate**: hollow pin, a link to the source, and since 08.08 either
   "not yet verified by us" or "Source checked" with the reason ([[queue-review]]). The
   map reads *not rejected*, NOT *pending* — filtering on `pending` meant believing a row
   deleted it. Nothing from the queue enters `places` or the graph.

## What is built and NOT wired up

Three things, named precisely:

- **`statement`, `about` and `stated_year` have a reader and no writer.** The film card
  prints them; nothing fills them. `/api/resolve` leaves `statement` null on purpose — a
  P915 statement says a work and a place are related and no more. The first real producer
  would be the 53 Open Plaques rows in the queue, and promoting them crosses "nothing from
  the queue enters the graph", so it is the owner's call.
- **`creator_place_links` exists and `creators` holds zero rows.** So **no fact of distance
  1 or 2 exists anywhere**, and the film card's two lower blocks have never been seen with
  live data.
- **`geocode_cache` is built, wired and empty.** The last run learned ~12,000 names; loading
  them needs `SUPABASE_SERVICE_ROLE_KEY`, which this machine does not have. An anon INSERT
  policy would fix the mechanics and is deliberately NOT added: an open write there lets a
  stranger poison a coordinate.

That is worth keeping true. The project's most repeated failure is finished work that never
reaches the live path: posters, ratings, three audio features, the personal library, the map
filter, all three place modules, then the entire 30k-row ingest. **Before writing a module,
grep for its callers** (`grep -rn "from .*<module>" app/`); if the answer is zero, wire that
before writing more.

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

**Some sessions have no `gh` at all** — a cloud container may ship the GitHub MCP instead.
The same two actions there: `actions_run_trigger` with method `run_workflow`, workflow
`deploy-production.yml`, ref `main`, inputs `{ref: main, confirm_production: "true"}`, then
`actions_list` → `list_workflow_jobs` and `get_job_logs` to read the result. Merging through
the MCP does not deploy either; **always fire the workflow yourself and read its log.**

**The deploy now says what production answers, not just that it deployed.** The last step
of `deploy-production.yml` curls the production domain by name and prints the body of
`/api/search`, `/api/cities/suggest` and `/api/directory/films`, and the status of
`/directory` and `/directory/films/s`. It has already paid for itself twice: it is how the
Olympics-above-Derry bug was found (#165), and on a session whose container cannot reach
Wikidata or Supabase **it is the only measuring instrument there is** — see the next trap.

**A measurement of the queue is a snapshot, not a fact.** Another branch works the same
production table: between two measurements forty minutes apart the resolved-row count went
0 → 34, the table lost 210 rows, and the movie-locations name statistics changed so much
that a whole planned task evaporated. **Quote the time next to any queue number, and
re-measure before acting on one.**

**The database has rules the repo does not describe.** Twice a constraint existed only in
production because another session applied it through the MCP without committing — and a
new `CHECK` was then rejected by 8,063 live rows. Read the live definition first: a
constraint is written against the database that exists, not the one in git. Measured on
08.08: **13 migrations existed in production and in no file**; all 13 are now committed.
Check it stays true — `select name from supabase_migrations.schema_migrations` against
`ls supabase/migrations/`.

**A schema change that is correct in SQL can still break the client.** `on_conflict` in
PostgREST is a promise about an index SHAPE, and nothing in the database says who relies on
it. Splitting a unique constraint into two PARTIAL indexes on 31.07 killed the only write
path into the graph for eight days — `ERROR 42P10`, raised *after* the Wikidata work had
succeeded, so the route looked busy. See [[fact-architecture]]. When you change a unique
index, grep for `onConflict`.

**`[hidden]` loses to any class that sets `display`.** The browser's own
`[hidden] { display: none }` is a bare attribute selector, so one `display: grid` on a class
renders a hidden tab panel anyway. Found as "both tabs are showing at once", which reads as
a React state bug and is not one.

**Never run `next build` while the dev server is up** — it clobbers `.next`. Check
`lsof -ti:3000`.

**`pkill -f "next start"` kills the shell that runs it** — the pattern matches that shell's
own command line — and then reports success. The next `next start` fails to bind, the old
process keeps serving, and you spend ten minutes reading screenshots of the PREVIOUS build
and blaming your CSS. Find the process and kill that:
`ps -eo pid,cmd | grep next-server`. A served page that contradicts the file on disk is
almost always a stale server rather than a stale stylesheet.

**A character range in SQL is resolved against the collation, and this database is not in
the C locale.** `~ '^[a-z]'` and `between 'a' and 'b'` both put `Á` inside the `a` bucket
under `en_US.UTF-8`. Use `strpos` over an explicit alphabet when the answer has to match
what JavaScript would say.

**Both halves of a sentence must be measured over the same rows.** The directory index first
read "6,392 films with 20,296 places" — a global work count beside a count of only what sat
near a listed city. Each number was right; the sentence was not.

**What the machine can reach is a property of the SESSION, not of the project, and both
previous notes here were right about their own container.** Measured from the cloud
container on 18.08, every one of these returned `000` — the egress proxy answered 403 to
CONNECT:

| host | from the cloud container |
|---|---|
| `<ref>.supabase.co` | blocked |
| `www.wikidata.org`, `query.wikidata.org` | blocked |
| `nominatim.openstreetmap.org` | blocked |
| `codex-hackathon-starter.vercel.app` | blocked |

The MCP servers (Supabase, GitHub, Vercel) still work there, because they are not egress
from this container. From the main clone on 19.08 the Supabase REST host answers and the
directory was verified live. **So test the specific host from your own container before
believing either note** — `curl -sS -m 8 -o /dev/null -w "%{http_code}" <url>` — and if it
is blocked, verify through the production smoke step and through MCP rather than concluding
the code is broken. Never disable TLS verification or unset `HTTPS_PROXY` to get around it.

**`Number("")` is 0 and 0 is finite.** Four Null Island incidents. `finiteOrNull` exists
for it — and it is not enough on its own: the Open Plaques dump ships a Leeds cinema with
`latitude 0.0` and a correct longitude, which only an explicit zero check catches.

**A name is never an identifier.** `Bowie` returns a hundred Texas markers about Jim
Bowie; `namesMatch` accepted one extra word and turned "Notting Hill Bookshop" into the
district; a union of Overpass `around` statements returns ONE result set, so an element
fetched for another point is still in the list — the name has to be inside the query and
checked again on the way out. **And a third time, on 19.08**: grouping the located rows by
the city written in their address gives "London" a spread of 10,959 km and "Richmond" 8,097
km, so a city page is a coordinate and a radius and the name is decoration ([[directory]]).

**Do not guess Q-ids.** Query by title and year.

**`wbsearchentities` returns the wrong entity far more often than it looks.** "Skyfall"
gave Adele's lyric video and "Parasite" an academic journal. The fix that works, and is
now used in three places: take 15 candidates, rank by `wikibase:sitelinks`, and only then
check the type.

**Another session takes the same next step, not only the same database.** On 18–19.08 two
sessions built #158 simultaneously from this page's own numbered list; one directory was
finished and discarded. Nothing here marks an item as taken, so **before starting one, run
`git fetch origin && git log --oneline HEAD..origin/main` and look at the open PRs.** One
second against a day.

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
creative people with Wikipedia links. As of 08.08 the schema is no longer in the way:
`creator_place_links` exists, a person's fact reaches a work through `work_creators`, and
`lived_here` / `wrote_here` / `died_here` / `buried_here` / `commemorated_here` are real
relation kinds instead of one vague `author_place`. What remains is **data**: `creators`
and `work_creators` hold zero rows, and filling them is a source problem, not a rules one.

## Next, in the order I would take it

**The critical path is closed.** The product had two surfaces and everything else was
reachable only by dragging a map; it now has three, they link to each other, and the search
box leads to all of them. #145, #158 and #160 all shipped on 18–19.08 and are verified on
production. What that changed, in one line each:

- **#145 — one search box** ([[search-box]]). Films and cities in one field, grouped, never
  awaited together. The city half is Wikidata rather than Nominatim — a type-ahead IS an
  auto-complete and that policy refuses it; `/api/cities` survives behind one clicked row.
- **#158 — the directory** ([[directory]]). An index, 27 letter pages covering every work,
  56 city pages, a sitemap. **A city is a point and a radius, never a name.** It also forced
  the fix that made it worth having: the card shows the review queue as labelled candidates,
  because only 14 of 6,392 rows led to a card with anything on it.
- **#160 — the place card as tabs** ([[place-card]]). Details / Route, a copyable
  coordinate, a panel that counts places and films apart.

**One half-issue is left behind by that work and is the cheapest thing on this list:**
**step 4 of #129 — the place card read from `place_facts`** — is not done. Everything else
in #129 is.

Then, in rough order of value:

1. **#157 — comments and visitor photos.** The moderation spine already exists; what needs
   deciding is who may write, EXIF stripping, licence, and that `rejected` hides a row but
   does not delete a file.
2. **#161 — the walk survives bad signal.** Becomes critical the day somebody first walks a
   route; nobody does yet.
3. **#159 — the dated satellite lens.** The most distinctive idea from either reference and
   the most on-brand: the place as it was when the camera was there. Esri Wayback is free,
   196 releases, **oldest 2014-02-20** — so it cannot answer for Vertigo, and the card must
   say so rather than showing 2014 under a 1958 film.

**Before starting any of them**, see the trap above about two sessions taking the same next
step: `git fetch origin && git log --oneline HEAD..origin/main`, and look at the open PRs.
Nothing on this page marks an item as taken.

**The data, not the pages, is now the ceiling.** Three of the four things worth doing next
are blocked on rows rather than on rendering, and they are the same three named under "built
and NOT wired up": `creators` is empty so no fact of distance 1 or 2 exists anywhere;
`statement` has no writer; `geocode_cache` is empty for want of a service-role key. A fourth
belongs beside them now — **`places.city` is null in all 70 rows** (18.08, 00:06 UTC), so
anything that wants to group by administrative area reverse-geocodes the queue's 32,148
located rows first (18.08, 20:23 UTC). The directory works
around that with a gazetteer of discs; a city FILTER on the map would not.

**Not to be built**, decided after studying both references: points/leaderboards (they
reward volume, and 914 rejections this week were good work), selling user maps, ads styled
as results, live-GPS buddy tracking, AI-generated "lore", and a 1–5 safety score.

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
- **A city row lists the same venue twice** when two sources spell it differently: Skyfall
  in London shows both "Broadgate Tower" and "Broadgate Tower, Bishopsgate, London". The
  `distinct` in `city_catalogue` is on the exact string; `place-dedup.mjs` already knows how
  to collapse these and is not wired into that query ([[directory]]).
- A **one-word title** ("Dracula", "Trainspotting") contributes nothing to the inverted
  search: `isSearchableEntity` needs two words, so such a work depends entirely on its
  fan-out.
- **Sherlock returns 5 places against Harry Potter's 26** — not a matching bug, a coverage
  one: the queue holds four rows for it.
- `api_help.html` and `lt.html` are research scratch in the main clone's root, untracked.
- Two other worktrees exist under `.claude/worktrees/`:
  `skype-ai-openrouter-movie-maps-bffab0` has **unmerged commits and uncommitted work**
  (leave it alone), and `youthful-lalande-fa0756` holds `claude/hackathon-prep-27a66c`.
