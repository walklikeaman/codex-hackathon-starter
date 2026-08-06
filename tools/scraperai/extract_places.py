"""Read the place out of a ReelStreets caption. One model call per FILM.

    .venv/bin/python extract_places.py --limit 5 --show     # try it first
    .venv/bin/python extract_places.py                      # all 3,536

ReelStreets writes prose, not addresses:

    "Jennifer follows two Men who have found her sister's dog. Walker's Court in Soho W1."
    "The French village square from which Fogg takes off in a balloon is a Universal Studios set."

There is no separator to split on -- the place is woven into the sentence, and
sometimes there is no place at all because the shot was a studio build. So the
caption has to be READ, which is the one job this project lets a model do:
`location-discovery` states the rule as "a model may name a place, never locate
one". This names. The geocoding cascade locates, separately, afterwards.

Cost discipline, same as the ScraperAI harvest: one call per film, batching that
film's ~27 captions, not one call per caption. 3,536 calls instead of 95,258.

Three outcomes come out of one question, not three. An early version asked for
a `kind` field alongside the place; on films with 40+ captions the model quietly
dropped it and every real place was recorded as unknown. So only the place and
its precision are asked for, and the kind is derived:

    real    -- a place was named
    studio  -- precision says set or backlot; the scene depicts somewhere else
    unknown -- no place (903 captions say "unidentified location")
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage

from openrouter import JsonOpenRouter, MissingApiKey, resolve_model
from state import ScrapeState, fingerprint

DATA = Path(__file__).resolve().parents[2] / 'data' / 'reelstreets'

SYSTEM = """You extract the real-world filming location named in a caption.

You are given captions from one film. Each describes a shot and usually names
where it was filmed. Return the place ONLY, stripped of the plot description.

Rules, in order of importance:
1. Copy the place from the text. Never infer, never complete a partial address
   from knowledge, never translate. If the caption says "Holloway Road", the
   place is "Holloway Road" -- not "Holloway Road, London, UK".
2. If the caption identifies no place -- "unidentified location", or it only
   describes action -- place is null.
3. A caption may mention other films that used the same spot ("also seen in
   'X'"). Those are film titles, not places. Ignore them.
4. Keep any street number, postcode or district that IS in the text.
5. Say how precise the place is. This is the difference between a place someone
   can stand at and a place that is only a mood:
     building -- a named building, venue or street number you could walk to
     street   -- a street, junction, square, park or stretch of road
     area     -- a district, suburb, village or neighbourhood
     region   -- a city, county, country or anything larger
     studio   -- a set, backlot or soundstage; the scene depicts somewhere it
                 was not shot, so the place is the studio, not the story
   "Japan" and "London" are region. "Holloway Road" is street. "Café des Deux
   Moulins, 15 Rue Lepic" is building.

Answer with JSON only:
{"captures": [{"i": <number>, "place": <string or null>,
               "precision": "building"|"street"|"area"|"region"|"studio"|null}]}

One entry per caption you were given, in the same order, with the same i."""


# Both observed failures -- a dropped field, then malformed JSON -- happened on
# films with 40+ captions, and neither happened on short ones. A free model gets
# less reliable the longer the list it has to keep straight, so the list is cut
# rather than the model replaced. ~3,800 calls instead of 3,536: no real cost.
CHUNK = 25

# OpenRouter caps :free models at 20 requests per minute, per account and not
# per key, and it is a hard 429 rather than a queue. Eight workers simply
# hammered it: 18 films through, the rest refused. So the pace is set here,
# globally across workers, a little under the cap.
FREE_TIER_RPM = 18


class RateLimiter:
    """One shared clock. N workers still add up to at most RPM per minute."""

    def __init__(self, per_minute: int):
        self.interval = 60.0 / max(per_minute, 1)
        self._lock = threading.Lock()
        self._next_at = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            if now < self._next_at:
                time.sleep(self._next_at - now)
            self._next_at = max(now, self._next_at) + self.interval


LIMITER = RateLimiter(FREE_TIER_RPM)


def build_prompt(film: dict, locations: list[dict]) -> str:
    lines = [f'Film: {film.get("title")} ({film.get("year")})']
    if film.get('locations_named'):
        # Region helps only as a sanity anchor; the model is still told to copy.
        lines.append(f'Filmed in: {", ".join(film["locations_named"])}')
    lines.append('')
    for location in locations:
        caption = (location.get('address') or '').strip()
        lines.append(f'{location["index"]}. {caption}')
    return '\n'.join(lines)


def extract_film(model: JsonOpenRouter, film: dict) -> dict:
    if not film.get('locations'):
        return {**{k: film[k] for k in ('id', 'slug', 'title', 'year')}, 'captures': []}

    def ask(batch: list[dict], depth: int = 0, retries: int = 5) -> list[dict]:
        """One call for one batch, splitting rather than repeating on bad JSON.

        At temperature 0 a retry sends a bit-identical request and gets a
        bit-identical answer, so repeating a batch the model cannot serialise
        is pure waste. Halving changes the input, makes progress, and narrows
        the blame down to the single caption that breaks it."""
        LIMITER.wait()
        try:
            response = model.invoke([
                SystemMessage(content=SYSTEM),
                HumanMessage(content=build_prompt(film, batch)),
            ])
            return (response or {}).get('captures', [])
        except Exception as exc:
            text = str(exc).lower()
            # Transient network trouble is NOT a batch the model could not
            # serialise, and splitting it discards captions for a reason that
            # will be gone in a second. An earlier version conflated the two and
            # silently lost 110 captions across 8 films to "Connection error".
            transient = ('rate limit' in text or '429' in text
                         or 'connection' in text or 'timeout' in text
                         or 'timed out' in text or 'temporarily' in text
                         or '502' in text or '503' in text or '504' in text)
            if transient:
                if retries <= 0:
                    print(f'  giving up on {film["slug"]} captions '
                          f'{batch[0]["index"]}-{batch[-1]["index"]}: {str(exc)[:60]}')
                    return []
                time.sleep(min(20, 3 * (6 - retries)))
                return ask(batch, depth, retries - 1)
            if len(batch) == 1 or depth > 4:
                print(f'  unparseable for {film["slug"]} caption '
                      f'{batch[0]["index"]}: {str(exc)[:70]}')
                return []
            middle = len(batch) // 2
            return ask(batch[:middle], depth + 1) + ask(batch[middle:], depth + 1)

    entries = []
    locations = film['locations']
    for start in range(0, len(locations), CHUNK):
        entries.extend(ask(locations[start:start + CHUNK]))

    by_index = {}
    for entry in entries:
        try:
            index = int(entry.get('i'))
        except (TypeError, ValueError):
            continue
        place = entry.get('place')
        precision = entry.get('precision')
        if precision not in ('building', 'street', 'area', 'region', 'studio'):
            precision = None
        if not isinstance(place, str) or not place.strip():
            place = None
        # Derived, not asked for: a named place is real unless it is a set, and
        # no place at all is unknown however confidently it was phrased.
        kind = 'unknown' if place is None else ('studio' if precision == 'studio' else 'real')
        by_index[index] = {'place': place, 'kind': kind, 'precision': precision}

    captures = []
    for location in film['locations']:
        answer = by_index.get(location['index'], {'place': None, 'kind': 'unknown', 'precision': None})
        captures.append({
            'index': location['index'],
            'caption': location.get('address'),
            'place': answer['place'],
            'kind': answer['kind'],
            'precision': answer['precision'],
            # Carried through so the ingest does not need to re-join the harvest.
            'lat': location.get('lat'),
            'lng': location.get('lng'),
            'also_seen_in': location.get('also_seen_in') or [],
            'then_url': location.get('then_url'),
            'now_url': location.get('now_url'),
            'now_note': location.get('now_note'),
            'now_by': location.get('now_by'),
            'now_date': location.get('now_date'),
        })

    return {
        'id': film['id'], 'slug': film['slug'], 'url': film['url'],
        'title': film['title'], 'year': film.get('year'),
        'director': film.get('director'),
        'regions': film.get('regions'),
        'captures': captures,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--limit', type=int)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--model')
    ap.add_argument('--show', action='store_true', help='print every extraction')
    ap.add_argument('--data', type=Path, default=DATA)
    args = ap.parse_args()

    source = args.data / 'films.ndjson'
    out_path = args.data / 'places.ndjson'
    if not source.exists():
        print(f'no {source} — run reelstreets.py first', file=sys.stderr)
        return 1

    films = [json.loads(line) for line in source.open(encoding='utf-8') if line.strip()]

    done = set()
    if out_path.exists():
        for line in out_path.open(encoding='utf-8'):
            if line.strip():
                try:
                    done.add(json.loads(line)['id'])
                except (json.JSONDecodeError, KeyError):
                    pass

    # This is where incrementality pays for itself. A full pass is 14 hours of
    # rate-limited model calls; a scheduled re-run should only re-read the films
    # whose captions actually changed. The fingerprint is taken over the
    # captions alone, so a film that gained a "now" photograph or had its
    # synopsis edited is NOT re-extracted -- nothing the model reads has moved.
    state = ScrapeState(args.data, 'reelstreets-places')
    prints = {f['id']: fingerprint([l.get('address') for l in f.get('locations', [])])
              for f in films}
    todo = [f for f in films
            if f['id'] not in done or state.has_changed(f['id'], prints[f['id']])]
    if args.limit:
        todo = todo[:args.limit]
    print(f'{len(films)} films, {len(done)} already extracted, {len(todo)} new or changed'
          + (f'  (last run {state.last_run})' if state.last_run else '  (first run)'))
    if not todo:
        return 0

    try:
        model = JsonOpenRouter(model_name=args.model, temperature=0)
    except MissingApiKey as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2
    print(f'model: {resolve_model(args.model)} via OpenRouter\n')

    started = time.monotonic()
    counts = {'real': 0, 'studio': 0, 'unknown': 0}
    precisions = {'building': 0, 'street': 0, 'area': 0, 'region': 0, 'studio': 0, None: 0}
    written = errors = 0

    with out_path.open('a', encoding='utf-8') as handle, \
            ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(extract_film, model, f): f for f in todo}
        for count, future in enumerate(as_completed(futures), 1):
            film = futures[future]
            try:
                result = future.result()
            except Exception as exc:
                errors += 1
                print(f'  {type(exc).__name__} on {film["slug"]}: {str(exc)[:160]}')
                continue

            for capture in result['captures']:
                counts[capture['kind']] += 1
                precisions[capture.get('precision')] += 1
            handle.write(json.dumps(result, ensure_ascii=False) + '\n')
            written += 1
            state.record(film['id'], None, prints[film['id']],
                         slug=film['slug'],
                         real=sum(1 for c in result['captures'] if c['kind'] == 'real'))

            if args.show:
                print(f'\n{result["title"]} ({result["year"]})')
                for capture in result['captures'][:8]:
                    mark = {'real': '•', 'studio': '▢', 'unknown': '·'}[capture['kind']]
                    print(f'  {mark} [{str(capture.get("precision") or "-")[:8]:8}] '
                          f'{str(capture["place"])[:52]:54} ← {(capture["caption"] or "")[:56]}')
            elif count % 50 == 0:
                handle.flush()
                rate = count / max(time.monotonic() - started, 1e-9)
                print(f'  {count}/{len(todo)}  {rate:.1f} films/s  '
                      f'~{(len(todo)-count)/max(rate,1e-9)/60:.0f} min left  '
                      f'{model.total_tokens} tokens  {errors} errors')

    total = sum(counts.values()) or 1
    state.save(extracted=written, errors=errors, tokens=model.total_tokens,
               model=resolve_model(args.model))
    print(f'\n{written} films, {errors} errors, {model.total_tokens} tokens -> {out_path}')
    print(f'captures: {counts["real"]} real ({counts["real"]*100//total}%), '
          f'{counts["studio"]} studio, {counts["unknown"]} unknown')
    # A region-level place is not somewhere anyone can stand; the ingest has to
    # know how many of these there are before it decides what to do with them.
    print('precision: ' + ', '.join(f'{k or "none"} {v}' for k, v in precisions.items()))
    return 0 if errors == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
