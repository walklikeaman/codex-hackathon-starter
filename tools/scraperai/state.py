"""Where each scrape got to, so the next run fetches only what changed.

A full pass is 24,089 MovieMaps pages and 3,536 ReelStreets films — an hour and
a half of somebody else's bandwidth to re-learn what we already know. Run on a
schedule, that is both rude and slow. This holds the watermark that makes a
re-run cheap.

Two signals, because the sites offer different ones and neither is sufficient
alone:

  * **The site's own timestamp.** MovieMaps puts <lastmod> on every sitemap
    entry; ReelStreets' WordPress API has `modified` and accepts
    `?modified_after=`. Either lets a run skip a record without fetching it,
    which is the only saving that actually costs nothing.
  * **A fingerprint of what we extracted.** Timestamps lie in both directions: a
    site can re-render a page without changing a fact, and can change a fact
    without touching the date. The fingerprint is taken over the fields we
    actually use, so a cosmetic change is not a change and a silent edit is.

The fingerprint is what makes the expensive downstream step skippable. Re-running
extract_places.py over 95,258 captions costs 14 hours of rate-limited model
calls; re-running it over the 40 captions that changed costs seconds.

State lives beside the data it describes, is plain JSON, and is safe to delete —
losing it costs a full pass, not correctness.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def fingerprint(value) -> str:
    """A stable hash of whatever we care about in a record.

    sort_keys so a dict that serialises in a different order is not mistaken
    for a change; the fields passed in are the caller's choice, and choosing
    fewer means fewer false alarms.
    """
    blob = json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(blob.encode('utf-8')).hexdigest()[:16]


class ScrapeState:
    """The watermark for one source.

    Usage is three calls:

        state = ScrapeState(Path('data/reelstreets'), 'reelstreets')
        if state.is_unchanged(film_id, remote_modified): continue   # skip fetch
        ...fetch and parse...
        state.record(film_id, remote_modified, fingerprint(parsed))
        state.save(fetched=n, skipped=m)
    """

    VERSION = 1

    def __init__(self, directory: Path, source: str):
        self.path = Path(directory) / 'state.json'
        self.source = source
        self.records: dict[str, dict] = {}
        self.runs: list[dict] = []
        self.load()

    # -- persistence ------------------------------------------------------
    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            # A truncated state file is not worth crashing over; the worst it
            # costs is one full pass, and pretending it is empty is honest.
            return
        if data.get('version') != self.VERSION:
            return
        self.records = data.get('records') or {}
        self.runs = data.get('runs') or []

    def save(self, **run_stats) -> None:
        self.runs.append({'at': utcnow(), **run_stats})
        payload = {
            'version': self.VERSION,
            'source': self.source,
            'updated_at': utcnow(),
            # Only the last ten, so the file stays readable. It is a log for a
            # human deciding whether the schedule is working, not an audit trail.
            'runs': self.runs[-10:],
            'records': self.records,
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Written through a temp file in the same directory: a run interrupted
        # mid-write must not leave a state file that describes nothing.
        handle = tempfile.NamedTemporaryFile(
            'w', encoding='utf-8', dir=self.path.parent, delete=False, suffix='.tmp')
        try:
            json.dump(payload, handle, ensure_ascii=False, indent=1)
            handle.flush()
            os.fsync(handle.fileno())
        finally:
            handle.close()
        os.replace(handle.name, self.path)

    # -- the decision -----------------------------------------------------
    @property
    def last_run(self) -> str | None:
        return self.runs[-1]['at'] if self.runs else None

    def is_unchanged(self, key: str, remote_modified: str | None) -> bool:
        """True when the site says this record has not moved since we stored it.

        Conservative in both directions: unknown to us means fetch, and an
        absent remote timestamp means fetch. Only an explicit "same or older"
        earns a skip.
        """
        known = self.records.get(str(key))
        if not known:
            return False
        if not remote_modified or not known.get('modified'):
            return False
        return str(remote_modified) <= str(known['modified'])

    def has_changed(self, key: str, new_fingerprint: str) -> bool:
        """True when what we extracted differs from last time — or is new.

        This is the one that gates expensive downstream work, so "new" counts
        as changed.
        """
        known = self.records.get(str(key))
        return not known or known.get('fingerprint') != new_fingerprint

    def record(self, key: str, remote_modified: str | None = None,
               new_fingerprint: str | None = None, **extra) -> bool:
        """Store the watermark. Returns whether the content changed."""
        key = str(key)
        changed = new_fingerprint is None or self.has_changed(key, new_fingerprint)
        entry = self.records.get(key, {})
        entry.update({
            'modified': remote_modified,
            'seen_at': utcnow(),
            **extra,
        })
        if new_fingerprint is not None:
            if changed and entry.get('fingerprint'):
                # Kept so a scheduled run can report "3 films changed" and name
                # when each last did, which is the question anyone will ask.
                entry['changed_at'] = utcnow()
            entry['fingerprint'] = new_fingerprint
        self.records[key] = entry
        return changed

    def summary(self) -> str:
        changed = sum(1 for r in self.records.values() if r.get('changed_at'))
        return (f'{len(self.records)} records tracked, {changed} have changed since first seen'
                + (f', last run {self.last_run}' if self.last_run else ''))
