"""Harvest movie-locations.com — 1,871 films, photographed location by location.

    .venv/bin/python movielocations.py --limit 20
    .venv/bin/python movielocations.py                  # all 1,871

The third scraped source, and the one with the best-formed captions. Where
ReelStreets writes a sentence with a place buried in it, this site writes:

    "Vertigo filming location: Scottie's home: 900 Lombard Street, and Coit Tower"

Film, then scene, then address, separated by colons. That is machine-readable,
so unlike ReelStreets this needs NO model call to find the place.

What it does not have, checked across Hot Fuzz, Vertigo, The Greatest Showman
and Notting Hill: no coordinates (the numbers that look like them are telephone
numbers), no IMDb ids, and **no film stills**. Every image is captioned
"<film> filming location: ..." and is a photograph OF THE PLACE, plus one
poster per film. That makes it a third kind of imagery next to MovieMaps' frames
and ReelStreets' then-and-now pairs: the location as the site photographed it.

robots.txt declares a sitemap and disallows nothing (checked 2026-08-06). Every
one of the 7,806 sitemap entries carries a <lastmod>, so incremental re-runs
work from the first pass.
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

from lxml import html as LH

from crawler import MovieMapsCrawler
from state import ScrapeState, fingerprint

BASE = 'https://movie-locations.com'
SITEMAP = f'{BASE}/pro-sitemaps-4055503.php'
OUT = Path(__file__).resolve().parents[2] / 'data' / 'movielocations'

_WS = re.compile(r'\s+')
# "Vertigo filming location: Scottie's home: 900 Lombard Street" — the film name
# always leads, and everything after the marker is scene-then-address.
#
# The marker itself varies more than it first appears: "filming location",
# "film location", and plain "location". The first version demanded one of the
# two-word forms, so every plain "<Film> location:" caption failed to split and
# the WHOLE caption became the place name — 3,125 of 5,783 rows, 54% of the
# source, already written to the database before a cross-source comparison
# surfaced them. Hence the optional word rather than the alternation.
_CAPTION = re.compile(r'^(.*?)\s+(?:filming\s+|film\s+)?location\s*:\s*(.*)$', re.I | re.S)


def clean(text):
    if not text:
        return None
    text = _WS.sub(' ', H.unescape(str(text))).strip(' :–—')
    return text or None


def split_caption(caption: str) -> tuple[str | None, str | None]:
    """(scene, place) out of "<film> filming location: <scene>: <place>".

    The address is the LAST colon-separated part, because a scene description
    can itself contain a colon and an address rarely ends in one. When there is
    only one part it is the place: many captions name a place and no scene.
    """
    match = _CAPTION.match(caption or '')
    if not match:
        return None, clean(caption)
    body = match.group(2)
    parts = [clean(p) for p in re.split(r':(?!\d)', body) if clean(p)]
    if not parts:
        return None, None
    if len(parts) == 1:
        return None, parts[0]
    return ' — '.join(parts[:-1]), parts[-1]


def absolute(src: str, page_url: str) -> str:
    from urllib.parse import urljoin
    return urljoin(page_url, src)


def parse_film(page_source: str, url: str) -> dict:
    tree = LH.fromstring(page_source)

    h1 = tree.xpath('//h1')
    heading = year = None
    if h1:
        heading = clean(''.join(h1[0].xpath('./text()')))
        span = clean(''.join(h1[0].xpath('./span//text()')))
        digits = re.search(r'\b(19|20)\d{2}\b', span or '')
        if digits:
            year = int(digits.group(0))

    text = _WS.sub(' ', H.unescape(' '.join(tree.xpath('//div[@id="main"]//text()'))))

    def field(label):
        match = re.search(rf'{label}\s*\|\s*(.*?)(?=\s+(?:DIRECTOR|CAST|Locations)\s*\||$)', text)
        return clean(match.group(1)) if match else None

    director = field('DIRECTOR')
    cast = field('CAST')
    regions = re.search(r'Locations\s*\|\s*(.*?)(?=\s+DIRECTOR\s*\||$)', text)

    locations = []
    seen = set()
    for block in tree.xpath('//div[div[@class="cap"]][.//img]'):
        image = (block.xpath('.//img[@alt]') or [None])[0]
        if image is None:
            continue
        src = image.get('src') or ''
        # /artwork/ is the site's own logo and furniture, not a location.
        if '/artwork/' in src:
            continue
        alt = clean(image.get('alt')) or ''
        caption = clean(block.xpath('./div[@class="cap"]')[0].text_content())
        if 'location' not in (caption or alt).lower():
            continue  # the poster

        scene, place = split_caption(caption or alt)
        if not place or place.lower() in seen:
            continue
        seen.add(place.lower())
        locations.append({
            'index': len(locations) + 1,
            'place': place,
            'scene': scene,
            'caption': caption or alt,
            # A photograph of the location, by the site. Recorded as a link;
            # nothing is downloaded. The site states no licence anywhere.
            'photo_url': absolute(image.get('src'), url) if image.get('src') else None,
        })

    return {
        'type': 'film',
        'id': url.rstrip('/').split('/')[-1].replace('.php', ''),
        'url': url,
        'title': heading,
        'year': year,
        'director': director,
        'cast': [clean(c) for c in re.split(r',\s*', cast)] if cast else None,
        'regions': [clean(r) for r in re.split(r'[;,]\s*', regions.group(1))] if regions else None,
        'locations': locations,
        'location_count': len(locations),
        'with_photo': sum(1 for l in locations if l['photo_url']),
    }


def film_urls(crawler: MovieMapsCrawler) -> list[tuple[str, str | None]]:
    """(url, lastmod) for every film page in the sitemap."""
    xml = crawler.fetch(SITEMAP)
    entries = []
    for block in re.findall(r'<url>(.*?)</url>', xml, re.S):
        loc = re.search(r'<loc>([^<]+)</loc>', block)
        if not loc or '/movies/' not in loc.group(1) or loc.group(1).endswith('-movies.php'):
            continue
        lastmod = re.search(r'<lastmod>([^<]+)</lastmod>', block)
        entries.append((loc.group(1), lastmod.group(1) if lastmod else None))
    return entries


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--limit', type=int)
    ap.add_argument('--delay', type=float, default=0.4)
    ap.add_argument('--workers', type=int, default=3)
    ap.add_argument('--out', type=Path, default=OUT)
    ap.add_argument('--full', action='store_true', help='ignore the watermark')
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / 'films.ndjson'
    # robots.txt disallows nothing; it only declares the sitemap.
    crawler = MovieMapsCrawler(delay=args.delay, base=BASE, blocked_paths=())
    state = ScrapeState(args.out, 'movielocations')
    print(state.summary() if state.last_run else 'first run — no watermark yet')

    entries = film_urls(crawler)
    print(f'{len(entries)} film pages in the sitemap')

    done = set()
    if out_path.exists():
        for line in out_path.open(encoding='utf-8'):
            if line.strip():
                try:
                    done.add(json.loads(line)['id'])
                except (json.JSONDecodeError, KeyError):
                    pass

    def key(url):
        return url.rstrip('/').split('/')[-1].replace('.php', '')

    todo = [(u, m) for u, m in entries
            if args.full or key(u) not in done or not state.is_unchanged(key(u), m)]
    if args.limit:
        todo = todo[:args.limit]
    print(f'{len(done)} on disk, {len(todo)} new or changed\n')
    if not todo:
        return 0

    started = time.monotonic()
    written = errors = changed = 0
    with out_path.open('a', encoding='utf-8') as handle, \
            ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(crawler.fetch, u): (u, m) for u, m in todo}
        for count, future in enumerate(as_completed(futures), 1):
            url, lastmod = futures[future]
            try:
                record = parse_film(future.result(), url)
            except Exception as exc:
                errors += 1
                print(f'  {type(exc).__name__} on {url}: {str(exc)[:100]}')
                continue
            handle.write(json.dumps(record, ensure_ascii=False) + '\n')
            written += 1
            if state.record(record['id'], lastmod, fingerprint(record['locations']),
                            locations=record['location_count']):
                changed += 1
            if count % 200 == 0:
                handle.flush()
                rate = count / max(time.monotonic() - started, 1e-9)
                print(f'  {count}/{len(todo)}  {rate:.1f}/s  ~{(len(todo)-count)/max(rate,1e-9)/60:.0f} min left')

    state.save(fetched=written, changed=changed, errors=errors, http=dict(crawler.stats))
    print(f'\n{written} films, {changed} changed, {errors} errors -> {out_path}')
    print(f'http: {crawler.stats}')
    return 0 if errors == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
