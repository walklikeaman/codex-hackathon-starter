"""Replay the discovered recipe across every MovieMaps page. No LLM involved.

discover.py spends model tokens once to work out where the fields are;
this walks the sitemaps and applies those selectors. 18,048 location pages and
6,041 movie pages, so the two knobs that matter are politeness (--delay) and
resumability (NDJSON append, already-seen ids skipped on restart).

    .venv/bin/python harvest.py --kind location --limit 200      # sample
    .venv/bin/python harvest.py --kind both                      # everything

Writes data/moviemaps/{locations,movies}.ndjson plus a summary.json. Re-running
is cheap: pages already on disk come from .cache/ and finished ids are skipped.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from crawler import MovieMapsCrawler, sitemap_entries
from state import ScrapeState, fingerprint
from extract import entity_id, parse_location, parse_movie

OUT_DIR = Path(__file__).resolve().parents[2] / 'data' / 'moviemaps'

KINDS = {
    'location': {'sitemap': 'sitemap-locations', 'parse': parse_location, 'file': 'locations.ndjson'},
    'movie': {'sitemap': 'sitemap-movies', 'parse': parse_movie, 'file': 'movies.ndjson'},
}


def already_done(path: Path) -> set[str]:
    """Ids present in a partial NDJSON, so a re-run resumes instead of redoing."""
    if not path.exists():
        return set()
    seen = set()
    with path.open(encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                seen.add(json.loads(line)['id'])
            except (json.JSONDecodeError, KeyError):
                continue
    return seen


def harvest(kind: str, crawler: MovieMapsCrawler, out_dir: Path,
            limit: int | None, workers: int) -> dict:
    spec = KINDS[kind]
    out_path = out_dir / spec['file']
    entries = sitemap_entries(crawler, spec['sitemap'])
    urls = [url for url, _ in entries]

    done = already_done(out_path)
    state = ScrapeState(out_dir, f'moviemaps-{kind}')
    # A page is fetched when we have never had it, OR when the sitemap says it
    # moved since we last stored it. Both halves matter: the first is a resume,
    # the second is what makes a scheduled re-run worth running.
    todo = [url for url, lastmod in entries
            if entity_id(url) not in done or not state.is_unchanged(entity_id(url), lastmod)]
    lastmod_by_url = dict(entries)
    if limit:
        todo = todo[:limit]

    print(f'[{kind}] {len(urls)} in sitemap, {len(done)} on disk, {len(todo)} new or changed'
          + (f'  (last run {state.last_run})' if state.last_run else '  (first run)'))
    if not todo:
        return {'kind': kind, 'total': len(urls), 'harvested': len(done), 'new': 0, 'errors': 0}

    started = time.monotonic()
    errors: list[dict] = []
    written = changed = 0

    def fetch_one(url: str):
        return url, crawler.fetch(url)

    with out_path.open('a', encoding='utf-8') as handle, \
            ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fetch_one, url) for url in todo]
        for index, future in enumerate(as_completed(futures), 1):
            try:
                url, page_source = future.result()
                record = spec['parse'](page_source, url)
            except Exception as exc:  # keep going; one bad page is not a failed run
                errors.append({'error': f'{type(exc).__name__}: {exc}'})
                continue

            handle.write(json.dumps(record, ensure_ascii=False) + '\n')
            written += 1
            if state.record(record['id'], lastmod_by_url.get(url), fingerprint(record)):
                changed += 1
            if index % 250 == 0:
                handle.flush()
                rate = index / max(time.monotonic() - started, 1e-9)
                remaining = (len(todo) - index) / max(rate, 1e-9)
                print(f'[{kind}] {index}/{len(todo)}  {rate:.1f}/s  ~{remaining / 60:.0f} min left  '
                      f'({len(errors)} errors)')

    elapsed = time.monotonic() - started
    state.save(fetched=written, changed=changed, errors=len(errors))
    print(f'[{kind}] done: {written} records ({changed} with changed content) '
          f'in {elapsed / 60:.1f} min, {len(errors)} errors -> {out_path}')
    return {
        'kind': kind,
        'total': len(urls),
        'harvested': len(done) + written,
        'new': written,
        'changed': changed,
        'errors': len(errors),
        'error_sample': errors[:5],
        'seconds': round(elapsed, 1),
    }


def summarise(out_dir: Path) -> dict:
    """Counts worth eyeballing before anyone imports this into GloryMap."""
    stats: dict = {}
    locations = out_dir / 'locations.ndjson'
    if locations.exists():
        total = geocoded = with_frames = frames = with_address = 0
        with locations.open(encoding='utf-8') as handle:
            for line in handle:
                if not line.strip():
                    continue
                record = json.loads(line)
                total += 1
                geocoded += bool(record.get('lat') and record.get('lng'))
                with_address += bool(record.get('address'))
                count = record.get('frame_count', 0)
                frames += count
                with_frames += bool(count)
        stats['locations'] = {
            'records': total,
            'with_coordinates': geocoded,
            'with_address': with_address,
            'with_frames': with_frames,
            'frames_total': frames,
        }

    movies = out_dir / 'movies.ndjson'
    if movies.exists():
        total = with_imdb = with_locations = location_links = 0
        with movies.open(encoding='utf-8') as handle:
            for line in handle:
                if not line.strip():
                    continue
                record = json.loads(line)
                total += 1
                with_imdb += bool(record.get('external', {}).get('imdb_id'))
                count = len(record.get('locations', []))
                location_links += count
                with_locations += bool(count)
        stats['movies'] = {
            'records': total,
            'with_imdb_id': with_imdb,
            'with_locations': with_locations,
            'location_links_total': location_links,
        }
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--kind', choices=[*KINDS, 'both'], default='both')
    ap.add_argument('--limit', type=int, help='stop after N new pages per kind')
    ap.add_argument('--delay', type=float, default=0.25,
                    help='seconds between requests, globally across workers (default 0.25)')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--out', type=Path, default=OUT_DIR)
    ap.add_argument('--no-cache', action='store_true', help='ignore .cache/ and refetch')
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    crawler = MovieMapsCrawler(delay=args.delay, use_cache=not args.no_cache)

    kinds = list(KINDS) if args.kind == 'both' else [args.kind]
    runs = [harvest(kind, crawler, args.out, args.limit, args.workers) for kind in kinds]

    summary = {
        'source': 'https://moviemaps.org',
        'robots_txt': 'Disallow: /search only (checked 2026-08-05)',
        'runs': runs,
        'http': crawler.stats,
        'stats': summarise(args.out),
    }
    (args.out / 'summary.json').write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(summary['stats'], indent=2))
    return 0 if all(r['errors'] == 0 for r in runs) else 1


if __name__ == '__main__':
    sys.exit(main())
