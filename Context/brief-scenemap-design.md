# Handover for Codex — SceneMap (working title)

> A brief for designing and building the MVP. Self-contained: it holds the whole
> idea, the verified data sources, the demo path, the scope, and the work order.
> Read it in full, then fill in the "Project" block in `AGENTS.md` from section 9
> and start with section 8.

## 1. The idea in one sentence

A map of places from your favorite films and books: you connect your film library
(a Letterboxd/IMDb export) or pick your favorite films — the map lights up with
points where their scenes were shot; you click a point and see a frame from the
film and that same place today, build a walking "movie stroll" route, and go
shoot the same shots yourself.

## 2. Why it wins (wow demo)

- **Personalization**: not a "map of all films" (that already exists —
  moviemaps.org), but a map of EXACTLY YOUR films. Upload your list and you see
  your own world of cinema.
- **The "frame ↔ place today" pair**: a film frame next to today's view of the
  street — an instantly understandable and shareable wow moment.
- **Route**: the points within a single city come together into a walking
  "movie stroll" — a ready-made tourist product whose value is obvious to the
  judges.

## 3. The single demo path (sacred; everything else is secondary)

1. Open the app → the "pick your films" screen: a quick pick from popular ones
   (a poster gallery, multi-select) OR a Letterboxd CSV upload.
2. The map (London or New York — that's where the data is richest) lights up with
   pins for the user's films.
3. Click a pin → a card: poster + scene title + description, a film frame
   (TMDB backdrop), the "place today" (photo), an "add to route" button.
4. Added 3 points → "Build the stroll" → a walking route on the map with the
   visiting order and distance.

We demo on a city with rich data (London/New York/Paris).
NOT Tel Aviv — the open data for it is almost empty (verified).

## 4. Data sources — verified with live queries on 21.07.2026

### Locations (the core) — Wikidata SPARQL, free, no keys

- **23 018 films** have geocoded filming locations:
  property `P915` (filming location) + `P625` (coordinates).
- **12 878 books** have geocoded settings: property `P840`
  (narrative location) — books are covered by the same query.
- Endpoint: `https://query.wikidata.org/sparql` (GET, `format=json`,
  a `User-Agent` header is required).

A working query (films + locations + coordinates + poster image):

```sparql
SELECT ?film ?filmLabel ?locLabel ?coord ?image WHERE {
  ?film wdt:P31 wd:Q11424; wdt:P915 ?loc .
  ?loc wdt:P625 ?coord .
  OPTIONAL { ?loc wdt:P18 ?image . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

Strategy: dump the result set ONCE with a script into a Supabase table and then
work off your own database (the SPARQL endpoint is slow and rate-limited — don't
hit it from the client).

### Film metadata and images — TMDB API (free key)

- Search by title+year, posters, backdrops (frames), genres.
- Matching with Wikidata: Wikidata film entities have a `P4947` property
  (TMDB ID) — grab it in the same SPARQL query, the match is exact, no
  string-based lookups.

### "Your films" — without closed APIs

- **The Letterboxd API is closed** (access is by application, and data/LLM
  projects get rejected). Instead: the user's **CSV export** (Settings → Data →
  Export, the files `watched.csv` / `ratings.csv`, columns Name, Year, Rating).
  Parsing is trivial; match by title+year against our table.
- IMDb also gives out a ratings.csv — the same parser.
- For demo reliability the main path is picking from a gallery of popular films;
  CSV is a second entry point into the same flow.

### Books (if we have time — a second tab of the same flow)

- Wikidata `P840` — the setting. Covers/search — the Open Library API
  (open). The Goodreads API has been dead since 2020 — don't waste time on it.

### "The place today"

- Baseline (no keys): a location photo from Wikidata `P18` (Wikimedia Commons).
- Better (needs a Google key): the Street View Static API by coordinates —
  `https://maps.googleapis.com/maps/api/streetview?size=600x400&location={lat},{lng}&key=...`
  If there's no key by the start — Commons photos are enough for the demo.

### AI layer (OpenAI credits at the event)

There is no ready-made database of "specific scene → specific point." The LLM
fills that gap: for the selected film, a request to the OpenAI API
(`response_format: json`) — "3–5 famous scenes: filming location, coordinates,
1–2 sentences about what happens in the frame." The model knows famous
locations well; cache the result in Supabase (the `scenes` table) so the demo
doesn't depend on latency. This is both data enrichment and an honest AI
component of the project.

### Map and route

- **Leaflet + OpenStreetMap** — no keys and no setup; a dark tile style
  (CartoDB dark_matter — free tiles) for the cinematic look.
- Route: the public OSRM (`router.project-osrm.org/route/v1/foot/...`) —
  a walking route over 2–5 points; fallback — just a polyline between the points.

## 5. Stack and architecture

Next.js (App Router, JS) + Supabase + Vercel — everything is already set up in this repo.

```text
Supabase tables:
  locations  (film_tmdb_id, film_title, year, loc_name, lat, lng, commons_image)
  scenes     (film_tmdb_id, loc_id, scene_title, description, source: 'wikidata'|'ai')
  (no users/auth — the film-selection state lives in localStorage)

API routes:
  /api/films/search    — search/gallery of popular films (TMDB)
  /api/map?films=...   — pins for the selected films (from Supabase)
  /api/scenes/:filmId  — location scenes (cache → otherwise OpenAI → write to cache)

Script (one-off, node):
  scripts/seed-wikidata.mjs — SPARQL → Supabase locations
```

## 6. Design direction

- **Mood — cinema, night**: a dark map (CartoDB dark), the accent a warm
  "spotlight" amber/gold; pins like little thumbnail frames or
  clapperboard markers.
- The location card is like a film frame: the film backdrop on top, below it a
  "then/now" pair (two photos side by side), a short scene text, an "add to
  route" button.
- The route is a bright line over the dark map, numbered stops, total walking
  distance/time.
- Mobile-first: the demo may be opened from a phone; the map full-screen, the
  cards a bottom-sheet.

## 7. Out of scope (don't touch until the demo path is green)

- Authentication, accounts, profiles.
- Audio clips from films (rights + no API).
- Real Letterboxd/Amazon API integration (they're closed).
- Scraping moviemaps/movie-locations (no time, and a gray area).
- Location authenticity verification, moderation, UGC.
- Tel Aviv as the demo city (too little data).

## 8. Work order (vertical slices)

1. **Skeleton + map**: a page with Leaflet on dark tiles + 10 hardcoded
   London pins → deploy, confirm it lives on Vercel.
2. **Data**: `scripts/seed-wikidata.mjs` → the `locations` table is filled
   (thousands of rows); `/api/map` serves pins from the database.
3. **Film selection**: a gallery of popular films (TMDB) + multi-select → the map
   is filtered by the selection; the selection lives in localStorage.
4. **Location card**: TMDB backdrop + Commons/StreetView photo + scenes
   via `/api/scenes` (an LLM with a cache).
5. **Route**: a basket of points → OSRM → a line on the map.
6. **Polish**: `/ui-polish`, a full run-through of the demo path, a 60–90 sec screencast.

Slices 2–5 can be parallelized across people after slice 1 (the data contract — section 5).

## 9. The "Project" block for AGENTS.md (paste as is)

- **What we're building:** SceneMap — a map of places from your favorite films:
  you pick films → pins of filming locations → a "frame then / place now" card →
  a walking "movie stroll" route.
- **Category:** apps-for-life
- **Stack:** Next.js + Supabase + Vercel, Leaflet/OSM, Wikidata (locations),
  TMDB (posters/frames), OpenAI (scene descriptions).
- **The single demo path:** pick 3–5 films from the gallery → a map of London
  with pins → open a location card with a scene and a "now" photo → add
  3 points → build a walking route.
- **Out of scope for now:** auth, audio clips, live Letterboxd/Amazon APIs,
  scraping, books (second priority), Tel Aviv as the demo city.
