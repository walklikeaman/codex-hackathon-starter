# Wiki Log

Append-only, newest-first. One entry per meaningful operation.
Format: `## [YYYY-MM-DD] {update|ingest|decision|incident} | <short title>`

Tip: `grep "^## \[" log.md | head -20` shows recent activity.

---

## [2026-07-21] update | Filter placeholder Wikidata labels

- Excluded work and location records whose displayed label is an unresolved Wikidata identifier beginning with `Q`, including television-series (`Q6769811`) results without a human-readable name.

## [2026-07-21] update | Correct image PR synced with current main

- Resolved PR #24 conflicts with the books/series, nearby-location, and recreate-the-shot changes from current `main` without rewriting branch history.
- Preserved TMDB IDs only for films, HTTPS Commons place images, and the balanced Film/Series/Book API response.
- Recreate-the-shot now opens only with a real reference image; verified 23 unit tests, the production build, no-token fallback, and the TMDB-backed dialog in Chromium.

## [2026-07-21] update | Show every fetched work in the map UI

- Removed the five-work client cap, so the work selector and map now use every film, series, and book returned for the selected area.
- Raised the live map request to the supported 200-location API maximum; the global Wikidata catalogue remains queried by the active map area rather than loaded as tens of thousands of points at once.

## [2026-07-21] update | Current-location map control

- Added a browser-only current-location control that recenters the map, displays a blue position marker, and reloads nearby Wikidata works.
- Location access is requested only after the user presses the control; coordinates are never stored or sent anywhere except the existing nearby-locations request.

## [2026-07-21] update | Books and series in the live map

- Expanded the Wikidata endpoint to return films and television series by filming location (`P915`), plus books by narrative location (`P840`), all restricted to the selected map area.
- The map balances returned work types and labels every result, map pin, list entry, and detail card as Film, Series, or Book.

## [2026-07-21] update | Local recreate-the-shot demo

- Added the issue #21 mobile flow from each location card: local photo upload, adjustable overlay, then/now comparison, reset, and repeat upload.
- User images remain browser-only object URLs; the flow has no upload request or persistent storage.
- Verified the complete flow at 390 px in Chromium, including a long live-location title, keyboard opacity control, reset/re-upload, zero mutating network requests, all unit tests, and a production build.

## [2026-07-21] update | Correct film and place image sources

- Stopped reusing the Wikimedia place photo as the film image in live location cards; missing film media now renders an explicit placeholder instead of a misleading duplicate.
- Added Wikidata TMDB IDs and a server-only cached TMDB image endpoint, while keeping Commons images on HTTPS for the current-place side of the comparison.
- Verified seven unit tests, the production build, the no-token fallback in a real browser, and the distinct film/place image flow with an intercepted TMDB response.

## [2026-07-21] update | AI-guided film tour

- Added server-only `POST /api/tour`: OpenAI Responses API with `gpt-5.6-terra` returns an English tour through Structured Outputs.
- The model receives only the selected film and up to five current verified SceneMap locations, whether live Wikidata or fallback; schema and post-validation reject unknown, missing, or duplicated stops.
- The English-only UI shows the AI story and builds a real walking route in the suggested order while preserving city search, location image search, and the manual 3–5 stop route.
- Verified with 9 unit tests, a production build, a real API call, and browser AI/manual paths with a clean console.

## [2026-07-21] update | English location image search integrated

- Integrated PR #13 on top of the personal-library branch while preserving the English-only UI contract.
- Location cards now open a focused Bing Images query built from the film, place and scene without API keys.

## [2026-07-21] update | English-only UI review fix

- Translated all user-facing copy, accessibility labels, loading text, metadata, and API error messages under `app/` to English in response to PR #13 review feedback.
- Verified zero Cyrillic strings remain under `app/`, all four unit tests pass, the production build succeeds, and the live-data card plus image-search link work in an isolated browser session.

## [2026-07-21] update | Location image search

- Added a "Find scenes filmed here" action to every location card; it builds a focused image-search query from the film, place, and scene and opens Bing Images in a new tab.
- Kept the demo independent from API keys and embedded third-party results; verified the production build, unit tests, two location-specific queries, and the external search flow in a real browser.

## [2026-07-21] update | Letterboxd and IMDb personal movie library

- Replaced title-only connector matching with schema-aware Letterboxd and IMDb CSV parsing for titles, years, personal ratings, dates, URLs and IMDb IDs.
- Imports from both services merge into one searchable library, deduplicate matching movies and persist locally without account passwords or server uploads.
- Synced current `origin/main`, restored English-only app copy, passed 7 tests and `next build`, and verified an IMDb import with two persisted movies in a real browser.
- The live Wikidata request took 25–43 seconds during browser smoke; the deterministic fallback map remained interactive while it loaded.

## [2026-07-21] update | City search for the live film map

- Added a city-search control with London as the default. It geocodes only a submitted city query, recenters the map, and reloads nearby Wikidata filming locations.
- The city endpoint uses server-side cached Nominatim requests with an identifying User-Agent; no user location or search history is stored.
- Verified the flow by switching the local app from London to Paris and receiving Paris-area film locations.

## [2026-07-21] decision | IMDb integration deferred

- Removed the Check-ins CSV import and IMDb-specific API filtering. IMDb does not offer a supported personal-account API, and the project does not use scraping.

## [2026-07-21] update | SceneMap frontend consumes live locations API

- The map now fetches `/api/locations` on load for the London viewport and replaces its demo pins, film chips, location list, card, and route inputs with Wikidata results.
- The static London set remains a client-side fallback when the upstream request fails, so the MVP demo path stays available without persisting data.
- Verified visually in the local app: live film locations and Commons imagery render in the map and location card.

## [2026-07-21] update | Live Wikidata film-location API

- Added `GET /api/locations` for SceneMap. It requests Wikidata directly using the visible map center (`lat`, `lng`), `radius` in kilometres, and `limit`; defaults target London.
- The response normalizes film/location Wikidata IDs, labels, year, coordinates, and Commons image URL. Results are deduplicated per film-location pair and HTTP-cached for one hour.
- No Wikidata data is persisted in Supabase; the endpoint was verified with a live London request returning HTTP 200 and three coordinate-bearing locations.

## [2026-07-21] update | Real walking routes

- Added a server-side proxy to the public OpenStreetMap foot-routing service with validated coordinates, an 8-second timeout, and a clearly labeled straight-line fallback.
- The map now fits and draws the returned street geometry; the route summary uses router distance and duration and includes source attribution.
- Verified with 4 unit tests, a production build, a live API request, and the browser flow from 3 selected stops to a 13.1 km / 174 min London walking route.

## [2026-07-21] incident | First Vercel deploy targeted production

- Ветка `feature/scenemap-skeleton` запушена с commit `dd17ac7`; локальный и Vercel builds зелёные.
- Первый `vercel deploy --yes` после создания проекта неожиданно получил target `production`, хотя команда запускалась без `--prod`; deployment Ready и отвечает HTTP 200 на `https://codex-hackathon-starter-lac.vercel.app`.
- GitHub Login Connection в Vercel не настроен, поэтому автоматическая Git-интеграция не подключилась; ручной CLI deploy сработал. В guardrails добавлен явный `--target=preview` для новых проектов.

## [2026-07-21] update | SceneMap skeleton slice 1

- Зафиксирован brief в `Context/brief-scenemap-design.md` и заполнен блок «Проект» в `AGENTS.md`.
- Собран первый срез MVP: тёмная Leaflet-карта Лондона, 10 hardcoded film-location pins, карточка локации, список точек и локальная линия маршрута после добавления 3 stops.
- Supabase-схема и таблицы не создавались; следующий срез — контракт данных + seed/API.
## [2026-07-21] update | Codebase mapped for GSD initialization

- Created the seven reference documents in `.planning/codebase/`.
- Verified that every document is substantive and contains no detected secret patterns.
- Mapping commit: `734d97e` on `feature/gsd-project-setup`.
