"""Run ScraperAI (via OpenRouter) over MovieMaps and record what it finds.

This is the LLM half of the pipeline and it runs once, not per page. ScraperAI's
premise is that a model looks at one representative page, works out the XPaths,
and emits a reusable recipe; harvest.py then replays that recipe over 18k pages
with no model in the loop. Paying a per-page LLM cost for a site this regular
would be waste.

    export OPENROUTER_API_KEY=sk-or-v1-...
    .venv/bin/python discover.py                    # both page types
    .venv/bin/python discover.py --page-type location --model openai/gpt-oss-20b:free

Output lands in recipes/{location,movie}.json: the detected fields with their
XPaths and the first value each one pulled, so the selectors in extract.py can
be checked against what the model actually proposed.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from openai import AuthenticationError, NotFoundError
from scraperai.models import ScraperConfig, WebpageFields, WebpageType
from scraperai.utils.html import BAD_TAGS, GOOD_ATTRS, minify_html

from crawler import MovieMapsCrawler
from openrouter import MissingApiKey, make_parser, resolve_model

RECIPES = Path(__file__).parent / 'recipes'

# One representative page per type. Both were picked because they exercise the
# fields we care about: /locations/3 has an address, coordinates, a scene
# description and a five-frame gallery; /movies/1 has a saga, an IMDb link,
# six cities and locations with both "as" names and sources.
SAMPLES = {
    'location': 'https://moviemaps.org/locations/3',
    'movie': 'https://moviemaps.org/movies/1',
}

WANTED = {
    'location': (
        'The real-world place this page is about: its name, its street address, '
        'the short note describing what kind of place it is, and for every film '
        'listed on the page the film title, the film URL, the fictional name the '
        'place plays in that film, the description of the scene shot there, and '
        'the URLs of the screenshot images in that film section.'
    ),
    'movie': (
        'The film this page is about: its title, the description of where it was '
        'filmed, its poster image, its IMDb link, the collection or saga it '
        'belongs to, the cities it was filmed in, and for every filming location '
        'listed the location name, the location URL, the fictional name it plays, '
        'and the source credited for the identification.'
    ),
}


def discover(page_type: str, model: str | None, crawler: MovieMapsCrawler) -> dict:
    url = SAMPLES[page_type]
    print(f'[{page_type}] fetching {url}')
    crawler.get(url)

    # ScraperAI's own preprocessing: strip the page down to structure so the
    # model sees markup rather than prose, and so it fits a small context.
    # Two defaults have to be overridden for MovieMaps:
    #   - BAD_TAGS drops <noscript>, and MovieMaps puts every <img> inside one
    #     (the JS gallery replaces it). Dropping it hides all the frames.
    #   - GOOD_ATTRS drops img-key, which is where the gallery image ids live.
    page_source, substitutions = minify_html(
        crawler.page_source,
        good_attrs=GOOD_ATTRS | {'img-key'},
        bad_tags=BAD_TAGS - {'noscript'},
    )
    print(f'[{page_type}] minified {len(crawler.page_source)} -> {len(page_source)} bytes '
          f'({len(substitutions)} long texts substituted)')

    parser = make_parser(model_name=model)
    print(f'[{page_type}] asking {resolve_model(model)} via OpenRouter for field XPaths')
    fields: WebpageFields = parser.find_fields(page_source, WANTED[page_type])

    for field in fields.static_fields:
        print(f'  {field.field_name}: {field.field_xpath} -> {field.first_value!r}')
    for field in fields.dynamic_fields:
        print(f'  [dynamic] {field.section_name}: {field.name_xpath} / {field.value_xpath}')

    config = ScraperConfig(
        start_url=url,
        page_type=WebpageType.DETAILS,
        pagination=None,
        catalog_item=None,
        open_nested_pages=False,
        fields=fields,
        max_pages=1,
        max_rows=1,
    )

    RECIPES.mkdir(exist_ok=True)
    out = RECIPES / f'{page_type}.json'
    payload = json.loads(config.model_dump_json())
    payload['_meta'] = {
        'model': resolve_model(model),
        'provider': 'openrouter',
        'prompt': WANTED[page_type],
        'tokens': getattr(parser.json_lm_model, 'total_tokens', None),
    }
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'[{page_type}] wrote {out.relative_to(Path(__file__).parent)} '
          f'({len(fields.static_fields)} static, {len(fields.dynamic_fields)} dynamic fields, '
          f'{getattr(parser.json_lm_model, "total_tokens", "?")} tokens)')
    return payload


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--page-type', choices=sorted(SAMPLES), action='append',
                    help='repeatable; defaults to every page type')
    ap.add_argument('--model', help='OpenRouter model id; defaults to $OPENROUTER_MODEL')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)
    crawler = MovieMapsCrawler()

    try:
        for page_type in args.page_type or sorted(SAMPLES):
            discover(page_type, args.model, crawler)
    except MissingApiKey as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2
    except AuthenticationError as exc:
        # Worth distinguishing: a 401 here means the request reached OpenRouter
        # and the key was rejected, not that the base URL is wrong.
        print(f'error: OpenRouter rejected the key ({exc.message}). '
              f'Check OPENROUTER_API_KEY at https://openrouter.ai/settings/keys',
              file=sys.stderr)
        return 2
    except NotFoundError as exc:
        print(f'error: OpenRouter does not know the model {resolve_model(args.model)!r} '
              f'({exc.message}). Pick one from https://openrouter.ai/models',
              file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
