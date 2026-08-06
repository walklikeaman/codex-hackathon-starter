"""Harvest reelstreets.com — 3,536 films of then-and-now location photography.

    .venv/bin/python reelstreets.py --limit 50
    .venv/bin/python reelstreets.py                 # all 3,536

A different shape of source from MovieMaps, and the differences decide what can
be done with it:

  * **No coordinates anywhere.** Not in the HTML, not in a script payload, not
    in the API. Locations are prose -- "Top of Bevington Road at Golborne Road,
    London W10" -- which is often MORE precise than a MovieMaps place name, and
    is a street address a human wrote rather than a point anyone can plot.
  * **No IMDb ids anywhere.** Matching is title + year, which the permit ingest
    already shows is the expensive, risky path.
  * **Then AND now.** Every capture is paired with a photograph of the same spot
    today, taken by a contributor, dated and initialled.

The index comes from the WordPress REST API rather than the sitemap, because the
sitemap is broken: wp-sitemap-posts-films-1.xml holds a single entry and
films-2 404s, while /wp-json/wp/v2/films reports all 3,536 across 36 pages.

Rights, stated by the site itself at /how-to-submit and quoted here because it
is the fact that governs everything downstream:

    "All the screen captures depicted on this site remain copyright with the
    current title holders."

So captures are studio material by the site's own account, and the modern
photographs are contributors' work with no licence granted to anyone. This
harvester records image URLs so a reviewer can look, and downloads nothing.
"""

from __future__ import annotations

import argparse
import html as H
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from lxml import html as LH

from crawler import USER_AGENT, MovieMapsCrawler
from state import ScrapeState, fingerprint

BASE = 'https://www.reelstreets.com'
API = f'{BASE}/wp-json/wp/v2/films'
OUT = Path(__file__).resolve().parents[2] / 'data' / 'reelstreets'

_WS = re.compile(r'\s+')
# "also seen in 'Just Like a Woman', 'London Kills Me' 'Slade in Flame'" -- the
# site mixes straight and curly quotes, sometimes within one sentence.
_ALSO = re.compile(r"[‘'\"]([^’'\"]{2,80})[’'\"]")


def clean(text: str | None) -> str | None:
    if not text:
        return None
    text = _WS.sub(' ', H.unescape(text)).strip()
    return text or None


def film_index(session: requests.Session, limit: int | None = None,
               modified_after: str | None = None) -> list[dict]:
    """Every film the API lists, as slim records. 100 per page, 36 pages.

    `modified_after` is WordPress's own incremental filter, so a scheduled run
    asks the server for the short list instead of downloading all 36 pages to
    discover that 3,530 of them are unchanged. `modified` is requested for every
    record because it is the watermark the next run compares against.
    """
    films: list[dict] = []
    for page in range(1, 40):
        params = {
            'per_page': 100, 'page': page,
            '_fields': 'id,slug,link,title,date,modified,region',
        }
        if modified_after:
            params['modified_after'] = modified_after
        response = session.get(API, timeout=30, params=params)
        if response.status_code == 400:  # past the last page
            break
        response.raise_for_status()
        batch = response.json()
        if not batch:
            break
        films.extend(batch)
        print(f'  index page {page}: {len(films)} films')
        if limit and len(films) >= limit:
            return films[:limit]
        time.sleep(0.3)
    return films


# Every heading that ends a metadata value. `Storyline` was missing from the
# first version, so `Region(s)` ran to the end of the document and swallowed the
# synopsis, the donation appeal and the page's inline JavaScript.
_META_LABELS = ['Date', 'Director', 'Production Company', 'Stars',
                'Location(s)', 'Region(s)', 'Storyline', 'Additional Information',
                'Comments', 'Can you help']
_STOP = '|'.join(re.escape(l) for l in _META_LABELS)


def _meta(tree) -> dict:
    """The metadata strip: Date, Director, Production Company, Stars, Region(s)."""
    text = ' '.join(tree.xpath('//main//text()')) or ' '.join(tree.xpath('//body//text()'))
    text = _WS.sub(' ', H.unescape(text))
    # The strip sits before the captures; anything after the first caption is
    # location prose and must not be scanned for metadata.
    cut = text.find('Capture 1')
    if cut > 0:
        text = text[:cut]

    fields = {}
    for label, key in [('Date', 'year'), ('Director', 'director'),
                       ('Production Company', 'production'), ('Stars', 'stars'),
                       ('Location(s)', 'locations_named'), ('Region(s)', 'regions')]:
        match = re.search(rf'{re.escape(label)}:\s*(.*?)(?=\s+(?:{_STOP})\s*:|$)', text)
        if match:
            fields[key] = clean(match.group(1))
    if fields.get('year'):
        digits = re.search(r'\d{4}', fields['year'])
        fields['year'] = int(digits.group(0)) if digits else None
    for key in ('stars', 'locations_named', 'regions'):
        if fields.get(key):
            fields[key] = [clean(p) for p in re.split(r',\s*', fields[key]) if clean(p)]
    return fields


def parse_film(page_source: str, url: str, record: dict) -> dict:
    tree = LH.fromstring(page_source)

    # Each location is one .film column holding two tabs: the capture and the
    # photograph of the same spot today. The tab labels carry the visit date.
    locations = []
    for index, column in enumerate(tree.xpath('//div[contains(@class,"film")][.//p[@class="capdesc"]]'), 1):
        captions = [clean(node.text_content()) for node in column.xpath('.//p[@class="capdesc"]')]
        images = column.xpath('.//img[contains(@class,"captureimg")]/@src')
        labels = [clean(node.text_content()) for node in column.xpath('.//li[contains(@class,"tab-nav-link")]')]
        if not captions or not images:
            continue

        address = captions[0]
        # "…: also seen in 'X', 'Y'" — a location shared by several films is the
        # strongest signal here, because a shared spot is what makes a walk work.
        also = []
        if address and re.search(r'also (?:seen|used) in', address, re.I):
            tail = re.split(r'also (?:seen|used) in', address, flags=re.I)[-1]
            also = [clean(t) for t in _ALSO.findall(tail)]

        now_caption = captions[1] if len(captions) > 1 else None
        # Contributors sign with initials at the end: "The long standing Portfolio. SJ"
        by = None
        if now_caption:
            signature = re.search(r'\b([A-Z]{2,3})\s*$', now_caption)
            if signature:
                by = signature.group(1)
                now_caption = clean(now_caption[:signature.start()])

        # A handful of captions carry an explicit pair -- "Lat, long:
        # 48.8857089, 2.3439967". Rare, but it is the contributor stating the
        # point rather than us deriving one, so it is worth keeping apart from
        # everything the geocoder would have to guess at.
        lat = lng = None
        stated = re.search(r'[Ll]at\W{0,4}long\s*:\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)', address or '')
        if stated:
            lat, lng = float(stated.group(1)), float(stated.group(2))

        locations.append({
            'index': index,
            'address': address,
            'lat': lat,
            'lng': lng,
            'also_seen_in': also,
            # Links only. The site states the captures remain the studios'.
            'then_url': images[0] if images else None,
            'now_url': images[1] if len(images) > 1 else None,
            'now_note': now_caption,
            'now_by': by,
            'now_date': labels[1] if len(labels) > 1 else None,
        })

    return {
        'type': 'film',
        'id': record.get('id'),
        'slug': record.get('slug'),
        'url': url,
        'title': clean((record.get('title') or {}).get('rendered')),
        **_meta(tree),
        'locations': locations,
        'location_count': len(locations),
        'with_now_photo': sum(1 for l in locations if l['now_url']),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--limit', type=int)
    ap.add_argument('--delay', type=float, default=0.4)
    ap.add_argument('--workers', type=int, default=3)
    ap.add_argument('--out', type=Path, default=OUT)
    ap.add_argument('--full', action='store_true',
                    help='ignore the watermark and re-fetch everything')
    ap.add_argument('--since', help='only films modified after this ISO date')
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / 'films.ndjson'

    session = requests.Session()
    session.headers['User-Agent'] = USER_AGENT
    # robots.txt disallows only /wp-admin/ (checked 2026-08-05).
    crawler = MovieMapsCrawler(delay=args.delay, base=BASE, blocked_paths=('/wp-admin/',))

    state = ScrapeState(args.out, 'reelstreets')
    print(state.summary() if state.last_run else 'first run — no watermark yet')

    since = args.since or (None if args.full else state.last_run)
    print('indexing via the WordPress REST API (the sitemap is broken)'
          + (f', modified after {since}' if since else ''))
    films = film_index(session, args.limit, modified_after=since)
    print(f'{len(films)} films the API reports as new or changed\n')

    done = set()
    if out_path.exists():
        for line in out_path.open(encoding='utf-8'):
            if line.strip():
                try:
                    done.add(json.loads(line)['id'])
                except (json.JSONDecodeError, KeyError):
                    pass
    todo = [f for f in films
            if f['id'] not in done or not state.is_unchanged(f['id'], f.get('modified'))]
    print(f'{len(done)} already on disk, {len(todo)} to fetch')

    started = time.monotonic()
    written = errors = changed = 0
    with out_path.open('a', encoding='utf-8') as handle, \
            ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(crawler.fetch, f['link']): f for f in todo}
        for count, future in enumerate(as_completed(futures), 1):
            record = futures[future]
            try:
                page = future.result()
                parsed = parse_film(page, record['link'], record)
            except Exception as exc:
                errors += 1
                print(f'  {type(exc).__name__} on {record["link"]}: {exc}')
                continue
            handle.write(json.dumps(parsed, ensure_ascii=False) + '\n')
            written += 1
            # Fingerprint the locations only: the page's ads, related-film rail
            # and donation appeal change constantly and mean nothing to us.
            if state.record(record['id'], record.get('modified'),
                            fingerprint(parsed['locations']),
                            slug=record['slug'], locations=parsed['location_count']):
                changed += 1
            if count % 200 == 0:
                handle.flush()
                rate = count / max(time.monotonic() - started, 1e-9)
                print(f'  {count}/{len(todo)}  {rate:.1f}/s  ~{(len(todo)-count)/max(rate,1e-9)/60:.0f} min left')

    state.save(fetched=written, changed=changed, errors=errors,
               http=dict(crawler.stats))
    print(f'\n{written} films written, {changed} with changed content, '
          f'{errors} errors -> {out_path}')
    print(f'http: {crawler.stats}')
    print(f'watermark: {state.path}')
    return 0 if errors == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
