"""XPath extraction for MovieMaps location and movie pages.

The XPaths here are the ones ScraperAI's field detector proposes for these two
page types (see discover.py, and recipes/*.json for the recorded output). They
live in code rather than being read back out of the recipe because a MovieMaps
record is nested -- a location holds N appearances, each holding N frames --
and ScraperAI's WebpageFields models a flat row of static/dynamic fields. The
recipe fixes the selectors; this module composes them into the shape GloryMap
actually needs.

Frames are studio stills. Every one of them carries a copyright line on its
MovieMaps image page ("Copyright Touchstone Pictures" and so on), so the
extractor records the frame URL and its source page and leaves the bytes where
they are. Hot-link and attribute; do not re-host.
"""

from __future__ import annotations

import json
import re
from urllib.parse import parse_qs, urlsplit

from lxml import html

BASE = 'https://moviemaps.org'
IMG_HOST = 'https://storage.googleapis.com/moviemaps/img'

# MovieMaps serves only a whitelist of widths per image kind; anything else 403s.
FRAME_WIDTH = 940      # largest frame available
THUMB_WIDTH = 320
POSTER_WIDTH = 200

_WS = re.compile(r'\s+')
_H1_LOCATION_PREFIX = re.compile(r'^Movies Filmed (?:at|in|on)\s+', re.I)
_H1_MOVIE_SUFFIX = re.compile(r'\s+Filming Locations$', re.I)


def clean(text: str | None) -> str | None:
    if text is None:
        return None
    text = _WS.sub(' ', text).strip()
    return text or None


def node_text(node) -> str | None:
    return clean(node.text_content()) if node is not None else None


def first(nodes):
    return nodes[0] if nodes else None


def abs_url(href: str | None) -> str | None:
    if not href:
        return None
    if href.startswith('//'):
        return 'https:' + href
    if href.startswith('/'):
        return BASE + href
    return href


def entity_id(href: str | None) -> str | None:
    """`/locations/16e` -> `16e`. MovieMaps ids are base36-ish strings."""
    if not href:
        return None
    parts = [p for p in urlsplit(href).path.split('/') if p]
    return parts[-1] if parts else None


def image_urls(img_key: str) -> dict[str, str]:
    """`fji.39zmar` -> the served renditions of that image."""
    return {
        'full': f'{IMG_HOST}/{img_key}.{FRAME_WIDTH}.jpg',
        'thumb': f'{IMG_HOST}/{img_key}.{THUMB_WIDTH}.jpg',
    }


def _img_key_from_src(src: str | None) -> str | None:
    """`//storage.../img/11r9.a1jpe1.100.jpg` -> `11r9.a1jpe1`."""
    if not src:
        return None
    name = src.rsplit('/', 1)[-1]
    parts = name.split('.')
    return '.'.join(parts[:2]) if len(parts) >= 3 else None


def _poster(scope) -> dict | None:
    src = first(scope.xpath('.//figure[contains(@class,"poster")]//img/@src'))
    key = _img_key_from_src(src)
    if not key:
        return None
    return {
        'key': key,
        'url': f'{IMG_HOST}/{key}.{POSTER_WIDTH}.jpg',
        'full': f'{IMG_HOST}/{key}.{FRAME_WIDTH}.jpg',
    }


def _frames(scope) -> list[dict]:
    frames = []
    for figure in scope.xpath('.//figure[contains(@class,"thumbnail")]'):
        key = figure.get('img-key') or _img_key_from_src(first(figure.xpath('.//img/@src')))
        if not key:
            continue
        page = first(figure.xpath('.//a/@href'))
        frames.append({
            'id': entity_id(page) or key.split('.')[0],
            'key': key,
            'page': abs_url(page),
            **image_urls(key),
        })
    return frames


def _location_map_thumb(scope) -> dict | None:
    """The single representative photo a movie page shows next to a location."""
    src = first(scope.xpath('.//figure[contains(@class,"location-map")]//img/@src'))
    key = _img_key_from_src(src)
    return {'key': key, **image_urls(key)} if key else None


def _source(scope) -> dict | None:
    section = first(scope.xpath('.//section[@class="source"]'))
    if section is None:
        return None
    link = first(section.xpath('.//a'))
    return {
        'name': node_text(link),
        'url': link.get('href') if link is not None else None,
        'text': node_text(section),
    }


def _nearby_link_coords(tree) -> tuple[float | None, float | None]:
    """Fallback coordinates: the "browse nearby locations" link carries the
    location's own lat/lng in its query string."""
    href = first(tree.xpath('//a[contains(@href,"lat=") and contains(@href,"lng=")]/@href'))
    if not href:
        return None, None
    query = parse_qs(urlsplit(href).query)
    try:
        return float(query['lat'][0]), float(query['lng'][0])
    except (KeyError, IndexError, ValueError):
        return None, None


def _balanced_args(text: str, start: int) -> str | None:
    """Slice the argument list of a call, given the index just past its `(`."""
    depth, in_string, escaped = 1, None, False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == in_string:
                in_string = None
        elif char in '"\'':
            in_string = char
        elif char in '([{':
            depth += 1
        elif char in ')]}':
            depth -= 1
            if depth == 0:
                return text[start:index]
    return None


def bootstrap(page_source: str) -> tuple[str | None, list]:
    """The map payload MovieMaps hands its own JS.

    Every detail page ends with a call like::

        moviemaps.loadPublic('LocationDetail', {"lid": "3", "llat": 47.65…})
        moviemaps.loadPublic('MovieDetail', "1", [{"lid": "1", "llat": 49.35…}])

    This is the authoritative geodata -- coordinates, city, country, Street View
    pose, and on movie pages the fictional name each location plays (``lmloc``).
    The rendered HTML has none of it, because the map is drawn client-side.
    Returns (kind, args) with args parsed as JSON.
    """
    marker = "moviemaps.loadPublic("
    index = page_source.find(marker)
    if index < 0:
        return None, []
    raw = _balanced_args(page_source, index + len(marker))
    if raw is None:
        return None, []
    try:
        # The argument list is a comma-separated series of JSON literals, so it
        # parses as a JSON array once wrapped -- except the leading kind, which
        # JS single-quotes. Only that one is rewritten: apostrophes inside the
        # payload ("The Cullen's House") are legal JSON and must survive.
        args = json.loads('[' + re.sub(r"^\s*'([A-Za-z]+)'", r'"\1"', raw) + ']')
    except json.JSONDecodeError:
        return None, []
    kind = args[0] if args and isinstance(args[0], str) else None
    return kind, args


def _geo(entry: dict) -> dict:
    """Normalise one bootstrap location entry."""
    street_view = entry.get('lsv') or {}
    return {
        'lat': entry.get('llat'),
        'lng': entry.get('llng'),
        'city': {'id': entry.get('lcityId'), 'name': entry.get('lcityName')}
        if entry.get('lcityId') or entry.get('lcityName') else None,
        'country': entry.get('lcountry'),
        'map_zoom': entry.get('lzoom'),
        'street_view': {
            'lat': (street_view.get('position') or {}).get('lat'),
            'lng': (street_view.get('position') or {}).get('lng'),
            'heading': (street_view.get('pov') or {}).get('heading'),
            'pitch': (street_view.get('pov') or {}).get('pitch'),
            'zoom': street_view.get('zoom'),
        } if street_view.get('position') else None,
    }


def _trailing_as_name(h4) -> str | None:
    """A movie page writes the fictional name as a bare text node after the
    location link: `<h4><a>118 Stevens Drive</a> as The Cullen's House</h4>`."""
    tail = ' '.join(t for t in h4.xpath('./text()'))
    tail = clean(tail)
    if not tail:
        return None
    match = re.match(r'^as\s+(.*)$', tail, re.I)
    return clean(match.group(1)) if match else None


def parse_location(page_source: str, url: str) -> dict:
    tree = html.fromstring(page_source)
    description = first(tree.xpath('//section[@id="description"]'))

    kind, args = bootstrap(page_source)
    entry = args[1] if kind == 'LocationDetail' and len(args) > 1 and isinstance(args[1], dict) else {}
    geo = _geo(entry)
    if geo['lat'] is None:
        geo['lat'], geo['lng'] = _nearby_link_coords(tree)

    heading = node_text(first(tree.xpath('//section[@id="description"]/h1'))) or ''
    name = entry.get('lname') or clean(_H1_LOCATION_PREFIX.sub('', heading))

    appearances = []
    for article in tree.xpath('//main/section/article'):
        link = first(article.xpath('.//h4/a'))
        if link is None:
            continue
        href = link.get('href')
        appearances.append({
            'movie_id': entity_id(href),
            'movie_url': abs_url(href),
            'movie_title': node_text(link),
            'as_name': node_text(first(article.xpath('.//h5'))),
            'scene': node_text(first(article.xpath('.//div/p[not(ancestor::div[@class="markdown"])]'))),
            'note': node_text(first(article.xpath('.//div[@class="markdown"]'))),
            'poster': _poster(article),
            'frames': _frames(article),
        })

    nearby = []
    for link in tree.xpath('//div[@class="nearby"]/a[starts-with(@href,"/locations/")]'):
        nearby.append({
            'id': entity_id(link.get('href')),
            'url': abs_url(link.get('href')),
            'name': node_text(link),
        })

    return {
        'type': 'location',
        'id': entity_id(url),
        'url': url,
        'name': name,
        'address': node_text(first(tree.xpath('//section[@id="description"]/address'))),
        **geo,
        'note': node_text(first(description.xpath('./div[@class="markdown"]'))) if description is not None else None,
        'appearances': appearances,
        'nearby': nearby,
        'frame_count': sum(len(a['frames']) for a in appearances),
    }


def parse_movie(page_source: str, url: str) -> dict:
    tree = html.fromstring(page_source)
    description = first(tree.xpath('//section[@id="description"]'))

    heading = node_text(first(tree.xpath('//section[@id="description"]/h1'))) or ''
    title = clean(_H1_MOVIE_SUFFIX.sub('', heading))

    collection = first(tree.xpath('//section[@id="description"]//a[starts-with(@href,"/collections/")]'))
    cities = [
        {'id': entity_id(a.get('href')), 'url': abs_url(a.get('href')), 'name': node_text(a)}
        for a in tree.xpath('//p[contains(@class,"cities")]//a[starts-with(@href,"/cities/")]')
    ]

    external = {}
    for link in tree.xpath('//section[@id="description"]//ul[@class="links"]//a'):
        href = link.get('href') or ''
        if 'imdb.com' in href:
            external['imdb'] = href
            match = re.search(r'/(tt\d+)', href)
            if match:
                external['imdb_id'] = match.group(1)
        elif 'amazon.' in href:
            external['amazon'] = href

    # A movie page hands its map every location already geocoded, so the whole
    # film is placeable from this one request -- no per-location fetch needed.
    kind, args = bootstrap(page_source)
    geo_by_id: dict[str, dict] = {}
    if kind == 'MovieDetail':
        for arg in args:
            if isinstance(arg, list):
                geo_by_id = {e['lid']: e for e in arg if isinstance(e, dict) and e.get('lid')}
                break

    locations = []
    for article in tree.xpath('//main/section/article'):
        link = first(article.xpath('.//h4/a'))
        if link is None:
            continue
        href = link.get('href')
        location_id = entity_id(href)
        entry = geo_by_id.get(location_id, {})
        # lmloc is the fictional name from the map payload; the HTML says the
        # same thing but only when the page bothered to render an "as" clause.
        played_as = [n for n in (entry.get('lmloc') or []) if n]
        locations.append({
            'location_id': location_id,
            'location_url': abs_url(href),
            'location_name': entry.get('lname') or node_text(link),
            'as_name': _trailing_as_name(link.getparent()) or (played_as[0] if played_as else None),
            **_geo(entry),
            'note': node_text(first(article.xpath('.//div[@class="markdown"]'))),
            'thumb': _location_map_thumb(article),
            # Movie pages leave the per-location gallery for JS to fill; the
            # frames themselves are server-rendered on the location page.
            'frames': _frames(article),
            'source': _source(article),
        })

    # MovieMaps files series under /movies/ like everything else and never says
    # which is which -- but a series page links to /episodes/..., and a film has
    # nothing to link. That is the only signal on the page, and it is a reliable
    # one: it is how the site's own episode index is reached.
    episodes = [entity_id(href) for href in tree.xpath('//a[starts-with(@href,"/episodes/")]/@href')]

    return {
        'type': 'movie',
        'id': entity_id(url),
        'url': url,
        'title': title,
        'kind': 'series' if episodes else 'film',
        'episode_count': len(episodes),
        'blurb': node_text(first(description.xpath('./div[@class="markdown"]'))) if description is not None else None,
        'poster': _poster(description) if description is not None else None,
        'collection': {
            'id': entity_id(collection.get('href')),
            'url': abs_url(collection.get('href')),
            'name': node_text(collection),
        } if collection is not None else None,
        'external': external,
        'cities': cities,
        'locations': locations,
    }
