"""A polite HTTP crawler for MovieMaps, usable as a ScraperAI BaseCrawler.

ScraperAI's own RequestsCrawler is a one-line ``requests.get`` with no user
agent, no delay, no retry and no cache. Against 6k+ MovieMaps pages that is
both rude and slow to iterate on, so this replaces it. Selenium is not needed:
MovieMaps renders everything server-side (a movie page is ~13 KB of HTML with
the locations already in it).

What MovieMaps allows, checked 2026-08-05:
    https://moviemaps.org/robots.txt -> User-agent: *  /  Disallow: /search
Only /search is off limits, and the site publishes sitemaps for movies,
episodes, collections, locations, cities and images. This crawler stays off
/search and identifies itself.
"""

from __future__ import annotations

import hashlib
import logging
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests

from scraperai.crawlers.base import BaseCrawler
from scraperai.models import Pagination

logger = logging.getLogger('scraperai.moviemaps')

BASE = 'https://moviemaps.org'
USER_AGENT = (
    'GloryMapBot/0.1 (+https://github.com/walklikeaman/codex-hackathon-starter; '
    'contact via repo issues) python-requests'
)
CACHE_DIR = Path(__file__).parent / '.cache'


class Blocked(RuntimeError):
    pass


class MovieMapsCrawler(BaseCrawler):
    """Cached, rate-limited GET. Satisfies ScraperAI's BaseCrawler interface."""

    def __init__(self, delay: float = 0.7, cache_dir: Path = CACHE_DIR, use_cache: bool = True):
        self.delay = delay
        self.cache_dir = Path(cache_dir)
        self.use_cache = use_cache
        self.current_url: str | None = None
        self._page_source: str | None = None
        self._last_request_at = 0.0
        # fetch() is called from a thread pool by harvest.py; the pacing clock
        # is global so N workers still add up to one request every `delay`.
        self._pace_lock = threading.Lock()
        self.session = requests.Session()
        self.session.headers['User-Agent'] = USER_AGENT
        self.stats = {'fetched': 0, 'cached': 0, 'failed': 0}
        if self.use_cache:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _cache_path(self, url: str) -> Path:
        return self.cache_dir / f'{hashlib.sha1(url.encode()).hexdigest()}.html'

    def _pace(self) -> None:
        """Block until this thread may issue the next request."""
        with self._pace_lock:
            wait = self.delay - (time.monotonic() - self._last_request_at)
            if wait > 0:
                time.sleep(wait)
            self._last_request_at = time.monotonic()

    def fetch(self, url: str, retries: int = 3) -> str:
        if urlsplit(url).path.startswith('/search'):
            raise Blocked(f'robots.txt disallows /search: {url}')

        cached = self._cache_path(url)
        if self.use_cache and cached.exists():
            self.stats['cached'] += 1
            return cached.read_text(encoding='utf-8')

        last_error: Exception | None = None
        for attempt in range(retries):
            self._pace()
            try:
                response = self.session.get(url, timeout=30)
            except requests.RequestException as exc:
                last_error = exc
            else:
                if response.status_code == 200:
                    self.stats['fetched'] += 1
                    if self.use_cache:
                        cached.write_text(response.text, encoding='utf-8')
                    return response.text
                if response.status_code == 404:
                    raise FileNotFoundError(url)
                if response.status_code in (429, 503):
                    # Back off hard; the site is telling us to slow down.
                    time.sleep(5 * (attempt + 1))
                last_error = Blocked(f'HTTP {response.status_code} for {url}')
            time.sleep(1.5 * (attempt + 1))

        self.stats['failed'] += 1
        raise last_error or Blocked(url)

    # -- BaseCrawler ------------------------------------------------------
    def get(self, url: str) -> None:
        self.current_url = url
        self._page_source = self.fetch(url)

    @property
    def page_source(self) -> str:
        return self._page_source

    def switch_page(self, pagination: Pagination) -> bool:
        # MovieMaps detail pages carry their whole payload in one response.
        return False

    def get_screenshot_as_base64(self) -> str:
        raise NotImplementedError('MovieMaps is server-rendered; no screenshots needed')


def sitemap_urls(crawler: MovieMapsCrawler, name: str) -> list[str]:
    """Every <loc> in a MovieMaps sitemap, following its ?p= pages."""
    import re

    urls: list[str] = []
    index = crawler.fetch(f'{BASE}/sitemap.xml')
    pages = [loc for loc in re.findall(r'<loc>([^<]+)</loc>', index) if name in loc]
    if not pages:
        raise ValueError(f'no sitemap named {name!r}; index lists: {re.findall(r"sitemap-([a-z]+)", index)}')
    for page in pages:
        urls.extend(re.findall(r'<loc>([^<]+)</loc>', crawler.fetch(page)))
    return urls
