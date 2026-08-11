# ScraperAI → OpenRouter → MovieMaps

[ScraperAI](https://github.com/scraperai/scraperai) reads one page with a language
model, works out where the fields are, and hands back XPaths you can replay
forever. That split is the whole point: the model runs **once per page type**,
not once per page. 24,089 MovieMaps pages through an LLM would be absurd; two
pages through an LLM and 24,089 through lxml is not.

ScraperAI ships only OpenAI classes. `openrouter.py` swaps the base URL so it
runs on OpenRouter's free tier instead.

## Install

Python 3.11 — ScraperAI pins `langchain==0.1.16`, `numpy==1.26.4` and
`selenium==4.9.1`, which do not all resolve on 3.12+.

```bash
uv venv --python 3.11 tools/scraperai/.venv && VIRTUAL_ENV=tools/scraperai/.venv uv pip install scraperai
```

The venv, the HTTP cache and the harvest log are gitignored; the code and the
recipes are not.

## Run

Everything below runs from `tools/scraperai/`.

Harvest needs no API key at all — it replays the recorded recipe:

```bash
.venv/bin/python harvest.py --limit 200
```

Re-deriving the recipe does need one. `OPENROUTER_API_KEY` from the repo `.env`,
or exported:

```bash
.venv/bin/python discover.py
```

## What each file does

| file | role | LLM |
|---|---|---|
| `openrouter.py` | ScraperAI's `JsonOpenAI`/`VisionOpenAI`, pointed at OpenRouter | — |
| `crawler.py` | cached, rate-limited, UA-identified `BaseCrawler` | no |
| `discover.py` | ScraperAI field detection → `recipes/*.json` | **yes, twice** |
| `extract.py` | the recipe's XPaths, composed into nested records | no |
| `harvest.py` | sitemap walk → `data/moviemaps/*.ndjson` | no |

## Why OpenRouter needed more than a base URL

`JsonOpenAI` wraps every call in langchain's `get_openai_callback()`, which
prices tokens from a hardcoded OpenAI table. Through OpenRouter that table is
wrong for every model, so it reports `$0.000` and reads as a bug. `openrouter.py`
counts tokens off the response and leaves pricing to the OpenRouter dashboard.

Non-OpenAI models also return JSON inside a ``` fence even under
`response_format: json_object`, and `json.loads` on that raises deep inside a
parser, so the fence is stripped first.

The model must advertise `response_format`, because every ScraperAI parser asks
for JSON. The default is `google/gemma-4-26b-a4b-it:free` — free, 262k context,
and it takes image input, so it covers both the JSON parsers and the vision
page-type classifier. Check a replacement before switching:

```bash
curl -s https://openrouter.ai/api/v1/models | jq '.data[] | select(.id=="MODEL") | .supported_parameters'
```

Two other ScraperAI defaults had to be overridden for this site, both in
`discover.py`: its HTML minifier drops `<noscript>` and unknown attributes, and
MovieMaps puts every `<img>` inside a `<noscript>` and every gallery image id in
an `img-key` attribute. Left alone, the model never sees a single frame.

## What MovieMaps actually gives up

`robots.txt` disallows `/search` and nothing else (checked 2026-08-05), and the
site publishes sitemaps for movies, episodes, collections, locations, cities and
images. The crawler stays off `/search`, identifies itself, paces itself, and
caches, so a re-run costs nothing.

Pages are server-rendered, so no Selenium: a movie page is ~13 KB of HTML with
its locations already in it.

**The map payload is the prize.** Every detail page ends with a call like

```js
moviemaps.loadPublic('MovieDetail', "1", [{"lid": "1", "llat": 49.358…, "lcityName": "West Vancouver", "lmloc": ["The Cullen's House"]}, …])
```

That JSON is not in the rendered HTML — the map is drawn client-side — and it
carries coordinates, city, country, Street View camera pose, and the fictional
name each place plays. One movie page therefore geocodes the entire film. In the
sample, 150/150 locations had coordinates and 150/150 movies had an IMDb id;
without the payload the pages that lack a "nearby locations" link have no
coordinates at all.

Location pages add what the movie pages do not carry: street address, per-scene
description, and the frame galleries.

## Output

`data/moviemaps/locations.ndjson` — one place per line:

```jsonc
{
  "id": "3", "name": "Buckaroo Tavern",
  "address": "4201 Fremont Ave N Seattle, WA 98103-7221",
  "lat": 47.657832619073, "lng": -122.350122928619,
  "city": {"id": "3", "name": "Seattle"}, "country": "United States of America",
  "street_view": {"lat": 47.657808, "lng": -122.349962, "heading": -80.73, "pitch": 4.97},
  "appearances": [{
    "movie_id": "7", "movie_title": "10 Things I Hate About You",
    "as_name": "Buckaroo",
    "scene": "Cameron and Michael head to a biker bar to talk to Patrick about Kat.",
    "frames": [{"id": "fji", "page": "https://moviemaps.org/images/fji",
                "full": "https://storage.googleapis.com/moviemaps/img/fji.39zmar.940.jpg"}]
  }],
  "frame_count": 5
}
```

`data/moviemaps/movies.ndjson` — one film per line, with `title`, `blurb`,
`poster`, `collection` (the saga), `external.imdb_id`, `cities`, and `locations`
carrying the same geodata plus the credited `source` for each identification.

`summary.json` holds the counts worth checking before anyone trusts the set.

Images are served only at whitelisted widths — anything else 403s. Frames: 78,
160, 320, 940. Posters: 100, 200, 940.

## Into the database

```bash
node --env-file=.env.local scripts/ingest-moviemaps.mjs --dry-run
```

[`scripts/ingest-moviemaps.mjs`](../../scripts/ingest-moviemaps.mjs) reads the
NDJSON, matches films to `works` **on IMDb id and nothing else**, and queues
each location as a `pending` `location_submissions` row. No model call and no
network beyond Supabase — the scrape already happened and the match is an
equality join.

Title matching is deliberately absent. The permit ingest needs it and pays for
it with `isSearchableTitle()`, which refuses short titles because "Heat" matches
everything. Here both sides carry `tt`-ids, so a fuzzy fallback would be strictly
worse than reporting the miss: it would attach one film's locations to another
and look exactly like a success.

Two migrations go with it. `20260805020000` adds the `moviemaps` enum value and
nothing else, because Postgres refuses to *use* a new enum value in the
transaction that created it. `20260805030000` extends the evidence check — and
closes a hole while it is there: the existing `CASE source_kind` had no `ELSE`,
and a `CASE` that matches nothing returns NULL, which a `CHECK` treats as passed.
Every moviemaps row would have satisfied the provenance rule by not being
mentioned in it. It now ends in `else false`.

## Licensing, and what happens to the frames

moviemaps.org publishes **no terms, no licence page and no copyright statement** —
`/about`, `/terms`, `/legal` and `/copyright` all 404, and the homepage says
nothing (checked 2026-08-05). So every row is written with
`source_license: 'unstated'`. Not a guess at a permissive licence, and not the
`CC BY-SA 4.0` default this table deliberately dropped in `20260803000000`
precisely because a default licence becomes a false statement in the database
the moment a second source writes.

A MovieMaps row is therefore a **lead**: strong enough to put in front of a
reviewer, not licensed for its text or its images to be republished.

The frames follow from that. They are studio stills — each image page carries its
own copyright line, "Copyright Touchstone Pictures" — and `app/lib/work-artwork.mjs`
already states this project's policy: artwork comes from the licensed API and is
not scraped, because the art is studio-licensed. So the frames are **not**
downloaded and do **not** go into `work_images`; that table is keyed on a TMDB
`file_path` and holds the gallery the product renders. Copying a scraped still
into it would launder a scrape into product content.

Instead the URLs ride along in `location_submissions.source_media` as links, for
the reviewer: a frame beside the place is the best evidence this kind of
submission can offer.

## The run

Full harvest, 2026-08-05: 24,089 pages, 0 errors, 102 minutes.

| | |
|---|---|
| locations, all with coordinates and an address | 18,048 |
| frames catalogued | 90,764 |
| movies, all with an IMDb id | 6,041 |
| location↔film links | 30,386 |

Ingest over all 6,041 films: **12 matched, 144 submissions, 619 frames**, every
row `pending`. Verified field by field against what the script produced — 144/144
rows, zero differences (coordinates agree to 4e-14 degrees, which is float
readback formatting, and `source_media` compares equal once jsonb key order is
normalised).

The ceiling is the catalogue, not the scrape: `works` holds 15 rows, 12 with an
IMDb id, and 6,029 scraped films had an IMDb id we do not carry. Ingesting more
means adding works first — which is a decision about what belongs in the
catalogue, not something a scraper should do on its own.

If the product should show frames, the licensed route already exists: TMDB
backdrops, classified by `still-classify.mjs` and matched to places by
`scene-frame-match.mjs`. A MovieMaps frame can tell a reviewer *which* TMDB still
to look for; it should not be the pixels that ship.
