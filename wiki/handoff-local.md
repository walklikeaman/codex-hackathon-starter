# Continuing locally — step 4 of #129, half-done

Written mid-task, not at the end of one. The database half of "the place card read from
`place_facts`" is applied and verified; the reader is not written. This page is what a
local session needs to finish it without re-deciding anything, and why it should be a
local session rather than another cloud one.

Related: [[fact-architecture]], [[place-card]], [[search-box]], [[handoff]].

## Where the work stands

| | |
|---|---|
| done | `place_facts_at(uuid)` — the place card in one query, mirroring `work_facts(uuid)` from the other end |
| applied to production | migration `20260902075615_place_card_facts`, committed as the matching file |
| verified live | Trafalgar Square returns three facts — 28 Days Later, Love Actually, V for Vendetta — each its own row with its own evidence |
| **not done** | **the reader**: no route, no page, no link. `place_facts` still has no caller in `app/` |

`grep -rn "place_facts" app/` answers nothing, and by this project's own rule that is the
thing to fix before writing anything else.

## Why finish it locally

The cloud container this was started in can reach **none** of the project's own services.
Measured there, every one of these answered `000` — the egress proxy refuses CONNECT:

| host | cloud container | a laptop |
|---|---|---|
| `<ref>.supabase.co` | blocked | fine |
| `www.wikidata.org`, `query.wikidata.org` | blocked | fine |
| `nominatim.openstreetmap.org` | blocked | fine |
| `codex-hackathon-starter.vercel.app` | blocked | fine |

The Supabase, GitHub and Vercel MCP servers still work there, which is how the migration
above was applied and verified — but a **page** cannot be opened against real data, so the
only way to see a live answer was to deploy and read the production smoke step. That works
and it is slow: one round trip per look. Locally the same page renders against the real
database in a second, which is the whole reason to move.

Two more things that cost time there and do not exist locally: the container restarted
mid-session (background jobs die with it), and the MCP servers disconnected and reconnected
several times.

## Running it locally

```bash
git pull                       # everything below is already on main
./scaffold.sh                  # npm install + .env.local from .env.example
npm run dev                    # http://localhost:3000
node --test test/*.test.mjs    # 1,101 tests, zero network
```

`.env.local` ships with the public Supabase URL and anon key, which is all the place card
needs — it reads through PostgREST as `anon`, and `place_facts_at` is `security_invoker`
over views that are already public-read. Generate `SCENE_MATCH_SIGNING_SECRET` if you touch
the scene-match path (`openssl rand -base64 48`); nothing in this step does.

**1,101 tests, 1,099 pass, 2 report `cancelled`.** Those two are in `artwork-api.test.mjs`
and predate all of this; they reproduce on a clean `main`. 1,099/1,101 is the healthy
reading.

## The work left, with the decisions already made

Nothing here needs re-thinking — the shape follows the work card, which is the point of the
issue ("the same table read from different ends").

1. **`app/lib/place-url.mjs`** — `placePath({ id, name })` and `placeIdFromSlug`, mirroring
   `work-url.mjs` exactly: a readable half, `--`, the uuid; the parser proves the readable
   half is decorative. `slugifyTitle` is already exported from `work-url.mjs`.
2. **`app/api/place/route.js`** — `GET /api/place?id=<uuid>` → `{ place, facts }`, calling
   `place_facts_at`. DI the reader the way `/api/work` and `/api/directory/films` do, so the
   tests stay offline.
3. **`app/place/[slug]/page.jsx`** — server-rendered, calling the route handler directly
   (an absolute origin is not knowable inside a server component; both `/work/[slug]` and
   `/city/[slug]` already do this).
4. **Shape each row with `placeSummary()` from `work-profile.mjs`.** It already turns a
   `work_facts` row into sentence + distance + precision + evidence count, and
   `place_facts_at` returns the same columns on purpose. Group with `placeBlocks()` from
   `work-card.mjs` — same headings, same rule that distance 2 is never a route stop.
5. **Wire both ends.** The work card's place rows get a link to the place page; each fact on
   the place page links to its subject's card (`workPath`) when the subject is a work. A
   creator has no page yet — print the name, do not invent a link.
6. **Tests** (`test/place-card.test.mjs` exists for #160 — add `test/place-facts-api.test.mjs`)
   and a wiki entry.

### What the page may promise

Only the **70 places in the graph** have facts; a queue candidate has no canonical place row
and therefore no page. Treat an unknown id as `notFound()`, exactly as `/work/[slug]` treats
a stale uuid. Do not fall back to the queue here: the card's whole claim is "these are facts
we checked", and mixing labelled candidates into it would undo the distinction the work card
had to be corrected to make.

## Verify against these, they are real

Measured 2026-09-02, 07:54 UTC — a queue number is a snapshot, but these are graph rows and
the graph has not moved since 31 July:

| place | id | what it proves |
|---|---|---|
| Trafalgar Square | `1dace4f1-8d85-44af-a390-5fd851cc6564` | three films at one point, three facts, not merged — the acceptance case |
| London | `40d442dd-257e-424b-8043-50677eb30ca6` | 11 facts across 8 subjects, and a `city` precision badge on all of them |
| Old Royal Naval College | `e927ac0c-33a2-443d-921a-8d763ece4a63` | Skyfall and The Crown at one building |
| Pinewood Studios | `7fe13f73-86a1-4527-b9b5-5c75f37c3d25` | three films, and `depicts_elsewhere` — a studio is a real pin for something that happened elsewhere |

Across the graph: **92 facts, 70 places, 11 places with more than one fact, 6 with facts
from more than one subject.** Six is small and it is the number that matters — those six are
the pages a work card can never show.

**Every fact there is `distance` 0.** `creators` holds zero rows, so distance 1 and 2 have
no live data anywhere and the lower blocks will be empty until that changes ([[handoff]] names
it as one of the three built-and-unwired things). Build the blocks anyway — `placeBlocks()`
prints nothing for an empty distance — but do not "verify" them against live data, because
there is none to verify against.

## Traps, all of them already paid for

- **`pkill -f "next start"` kills the shell that runs it** and reports success. The old
  server keeps serving, the new one fails to bind, and you read screenshots of the previous
  build. `ps -eo pid,cmd | grep next-server`, kill that pid.
- **A served page that contradicts the file on disk is a stale server**, not a stale
  stylesheet. Ten minutes went into that once already.
- **Never `next build` while `next dev` is up** — they share `.next`.
- **Another session works the same production database.** Quote the time beside any queue
  number, and re-measure before acting on one.
- **Check the files still match production**: `select name from
  supabase_migrations.schema_migrations` against `ls supabase/migrations/`. As of this page
  they match, including `20260902075615`.
- **Before starting, `git fetch origin && git log --oneline HEAD..origin/main`** and look at
  the open PRs. Two sessions built #158 simultaneously on 18–19.08 and one finished
  directory was thrown away.

## Acceptance, from #129 itself

- A place where two films meet shows both facts and does not merge them.
- Every fact on a card opens its own source on click.
- No distance-2 fact enters a route silently.
- And the one this step adds: the work card and the place card cannot disagree, because
  both read `place_facts` — if they ever do, the bug is a second query somewhere, not a
  rendering difference.
