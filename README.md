# 🎬 GloryMap

**Turn the stories you love into places you can actually visit.**

GloryMap transforms your personal film library into an interactive map of real filming locations and story settings. Import a Letterboxd export, pick a city, discover which of your movies were filmed nearby, and build a walk that takes you from one scene to the next.

[🌍 Open the live demo](https://codex-hackathon-starter-nakonechnyin-8566-walklikeaman1904.vercel.app)

## ⚡ The elevator pitch

Streaming platforms remember what we watched, but they rarely help us experience those stories beyond the screen. GloryMap connects a personal movie library to the real world: upload a Letterboxd ZIP, choose a city, and instantly see the filming locations that belong to films you already care about. From there, you can explore scene context, compare the reference with the place today, hear an AI guide, and turn several stops into a walkable movie tour.

It is part travel planner, part film companion, and part excuse to look at a familiar city differently.

## ✨ What you can do

- 📦 **Import your Letterboxd archive** — upload the original ZIP without unpacking its folders. GloryMap reads `watched.csv` and `ratings.csv` locally in the browser.
- 🎞️ **Bring IMDb lists too** — standalone IMDb and Letterboxd CSV exports remain supported and are merged into one personal library.
- 🗺️ **Map your own movies** — after import, the map shows the intersection between your library and known locations in the selected city.
- 🌍 **Explore beyond London** — search for another city and the personal-library filter recalculates against the locations available there.
- 🔎 **Search films, series, and books** — discover filming locations and story settings from Wikidata, with cited research used for sparse results.
- 📍 **Open rich location cards** — see the work, relation type, address, distance, source, scene context, and “then vs now” imagery.
- 🙈 **Keep spoilers optional** — scene details stay hidden until you choose to reveal them.
- ❤️ **Save places for later** — “Want to visit” selections persist on the device.
- 🚶 **Build a real walking route** — choose 3–5 stops and get street-level distance and duration, with a safe fallback when routing is unavailable.
- ⏱️ **Plan by available time** — create 30, 60, or 120-minute tours around a city or your current position.
- 🎧 **Listen to the tour** — OpenAI narration supports spoiler-free mode and playback controls.
- 📸 **Recreate the shot** — line up your own photo with a reference frame using an overlay or side-by-side comparison.

## 🎥 The demo flow

1. Open **My movies**.
2. Choose **Letterboxd** and upload the complete export ZIP.
3. Pick a city.
4. GloryMap keeps the imported titles that have known locations in that city.
5. Open a pin to explore the scene and its source.
6. Add at least three locations.
7. Build a walking route and start the movie tour.

The current demo has been exercised with a real 2,422-film Letterboxd export. In the verified dataset, the library matched three titles and six locations in London, plus five titles and ten locations in New York. A city can correctly show zero personal matches when none of its currently available locations belong to the imported library.

## 🧠 How it works

```text
Letterboxd ZIP / IMDb CSV
          │
          ▼
 Local browser parsing ──► Personal library in localStorage
          │
          ▼
 Normalized title + year matching
          │
          ├──► Wikidata locations and source evidence
          ├──► TMDB reference imagery
          ├──► OpenStreetMap / walking router
          └──► OpenAI tour and voice narration
                         │
                         ▼
                A walkable story map
```

The archive never needs to reach the server. ZIP processing is capped at 25 MB, extracted CSV content at 10 MB, and only the two expected root files are read. Deleted, orphaned, review, and profile folders are ignored.

## 🛠️ Tech stack

| Layer | Technology |
| --- | --- |
| Web app | Next.js 15, React 19 |
| Map | Leaflet, React Leaflet, OpenStreetMap tiles |
| Location knowledge | Wikidata and cited web research |
| Film imagery | TMDB |
| Routes | Public pedestrian OSRM service with deterministic fallback |
| AI guide | OpenAI structured output and text-to-speech |
| Archive import | JSZip, local CSV parsing, `localStorage` |
| Validation | Node test runner, production builds, Playwright browser checks |
| Hosting | Vercel Preview deployments with gated production workflows |

## 🔐 Privacy by design

- Letterboxd ZIP and IMDb CSV files are parsed in the browser.
- Imported libraries and “Want to visit” choices stay in local browser storage.
- GloryMap never asks for a Letterboxd or IMDb password.
- Recreated-shot photos remain in the active browser tab and are not uploaded.
- API credentials stay in environment variables and are never committed.

Clearing site data removes the locally stored library and preferences.

## 🚀 Run it locally

### Requirements

- Node.js 20+
- npm

### Setup

```bash
git clone https://github.com/walklikeaman/codex-hackathon-starter.git
cd codex-hackathon-starter
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The core map and local imports work without an OpenAI key. AI-generated tour copy and voice narration require the corresponding server-side environment variables.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Shared project data endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase anonymous key |
| `OPENAI_API_KEY` | Server-side AI tour and narration requests |
| `OPENAI_MODEL` | Structured tour generation model |
| `OPENAI_TTS_MODEL` | Text-to-speech model |

Never commit `.env.local` or a Vercel token.

## ✅ Development commands

```bash
npm run dev      # Start the local Next.js server
npm test         # Run the Node test suite
npm run build    # Create and validate a production build
npm run start    # Serve the production build locally
```

Do not run `next dev` and `next build` at the same time in one checkout: both write to `.next` and can corrupt the development manifest.

## 🧭 API surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/cities` | Resolve a city and its map bounds |
| `GET /api/locations` | Find verified nearby or title-specific locations |
| `POST /api/locations/discover` | Supplement sparse results with cited research |
| `GET /api/film-image` | Select a suitable TMDB backdrop |
| `POST /api/route` | Build a pedestrian route for selected stops |
| `POST /api/tour` | Create a structured tour guide |
| `POST /api/narration` | Generate tour audio |

## 🗂️ Project structure

```text
app/
├── api/                    Route handlers for cities, locations, routes and AI
├── components/             Main map experience and voice guide
├── lib/                    Import, matching, routing and tour logic
├── globals.css             Responsive GloryMap interface
└── page.jsx                Application entry point
test/                       Node regression tests
wiki/                       Decisions, incidents and accumulated project knowledge
.github/workflows/          Gated Vercel staging and production deployments
```

## ⚠️ Honest limitations

- Location coverage depends on the quality and completeness of public source data.
- Personal-library matching currently uses normalized title and release year; alternate regional titles can still miss.
- A movie appears only when GloryMap has a usable location for the selected city.
- Route and research providers can rate-limit or time out, so the app uses clear fallbacks instead of pretending a result is exact.
- Protected film frames are not uploaded or redistributed.

## 🌱 What is next

- Better alternate-title matching for international releases
- More verified scene-level metadata and imagery
- Shareable personal tours without exposing a full library
- Broader city coverage while keeping every location traceable to a source

## 🤝 Built for OpenAI Build Week

GloryMap started as a focused hackathon idea: make one end-to-end experience feel real. The project is built with Codex-assisted engineering, a cumulative `wiki/`, explicit guardrails, and browser-verified demo loops so the repository remembers not only what changed, but why.

If you are reviewing the project, start with the [live demo](https://codex-hackathon-starter-nakonechnyin-8566-walklikeaman1904.vercel.app), import a Letterboxd ZIP, and take your movies for a walk. 🍿
