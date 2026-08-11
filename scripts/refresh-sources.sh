#!/usr/bin/env bash
#
# One scheduled pass over every source: fetch what changed, ingest it, and
# advance the slow enrichments by a bounded amount.
#
#   bash scripts/refresh-sources.sh              # the whole pipeline
#   bash scripts/refresh-sources.sh --dry-run    # ingests only, nothing written
#   bash scripts/refresh-sources.sh --install    # print a crontab line and exit
#
# Everything here is incremental and idempotent, which is what makes it safe to
# put on a timer. The harvesters compare the site's own <lastmod> (or the
# WordPress API's modified_after) against a watermark in data/*/state.json, and
# fingerprint what they extracted so a page that was merely re-rendered is not
# re-read. The ingests upsert on (work_id, place_key). A run that finds nothing
# new does nothing and says so.
#
# Two things a cron job must get right and a hand-run script can ignore:
#
#   * ONE AT A TIME. The Wikidata pass takes about 21 hours at a polite query
#     rate. Without a lock, the next night's run would start on top of it and
#     both would crawl the same sites. flock holds the whole pipeline.
#   * ITS OWN ENVIRONMENT. cron gets a near-empty PATH and no shell profile, so
#     node, python and the keys are all resolved explicitly below rather than
#     assumed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCK="$ROOT/.refresh.lock"
LOG_DIR="$ROOT/tmp/refresh"
LOG="$LOG_DIR/$(date -u +%Y-%m-%d).log"
PY="$ROOT/tools/scraperai/.venv/bin/python"
ENV_FILE="$ROOT/.env.local"

# How many pins one scheduled run resolves against Wikidata. 21 hours for the
# whole backlog is far too long to hold a nightly slot, and the resolver skips
# what it already answered, so a nightly slice drains it over a few weeks
# without ever blocking the rest.
WIKIDATA_BUDGET="${WIKIDATA_BUDGET:-1200}"

DRY_RUN=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="--dry-run" ;;
    --install) INSTALL=1 ;;
  esac
done

if [ "${INSTALL:-0}" = "1" ]; then
  cat <<EOF
Add this to your crontab (crontab -e). 04:15 on Mondays: the sites are quiet,
and weekly matches how often any of them actually changes.

15 4 * * 1 /bin/bash $ROOT/scripts/refresh-sources.sh >> $LOG_DIR/cron.log 2>&1

Logs land in $LOG_DIR, one file per day. The job holds $LOCK, so a run that
overruns simply blocks the next rather than doubling up.
EOF
  exit 0
fi

mkdir -p "$LOG_DIR"

say() { printf '\n\033[1m%s\033[0m\n' "$1" | tee -a "$LOG"; }
note() { printf '%s\n' "$1" | tee -a "$LOG"; }

# Run a step, keep going if it fails, and record that it failed. One site being
# down must not cost us the other two and the ingests.
FAILED=()
step() {
  local name="$1"; shift
  say "$name"
  if "$@" >>"$LOG" 2>&1; then
    note "  ok"
  else
    note "  FAILED (exit $?) — see $LOG"
    FAILED+=("$name")
  fi
}

main() {
  note "=== refresh started $(date -u +%Y-%m-%dT%H:%M:%SZ) ${DRY_RUN:+(dry run)}"
  [ -f "$ENV_FILE" ] || { note "no $ENV_FILE — nothing can run"; exit 1; }
  [ -x "$PY" ] || { note "no python venv at $PY — see tools/scraperai/README.md"; exit 1; }

  # --- fetch what moved -------------------------------------------------
  # Skipped under --dry-run, and that is the honest shape rather than a
  # shortcut: the harvesters have no dry mode, so "dry" would have meant
  # crawling three sites and spending model calls before deciding to write
  # nothing. What --dry-run is actually for is checking what the INGESTS would
  # do to the database, and they read from disk.
  if [ -n "$DRY_RUN" ]; then
    note ""
    note "skipping harvest and extract: --dry-run exercises the ingests only"
  else
    step "harvest moviemaps"      "$PY" tools/scraperai/harvest.py
    step "harvest reelstreets"    "$PY" tools/scraperai/reelstreets.py
    step "harvest movie-locations" "$PY" tools/scraperai/movielocations.py

    # Only films whose captions changed; the fingerprint covers the captions
    # alone, so a film that merely gained a photograph is not re-read.
    step "extract reelstreets places" "$PY" tools/scraperai/extract_places.py --model qwen/qwen3.7-flash
  fi

  # --- catalogue, then submissions --------------------------------------
  # Works first: a submission needs something to attach to, and both ingests
  # create only where nothing with that title exists.
  for pair in "reelstreets" "movielocations"; do
    step "works from $pair"       node --env-file="$ENV_FILE" "scripts/ingest-$pair-works.mjs" $DRY_RUN
  done
  for source in moviemaps reelstreets movielocations; do
    step "submissions from $source" node --env-file="$ENV_FILE" "scripts/ingest-$source.mjs" $DRY_RUN
  done

  # --- enrichment -------------------------------------------------------
  step "corroborate across sources" node --env-file="$ENV_FILE" scripts/corroborate-sources.mjs $DRY_RUN
  # The resolver's own --dry-run skips the write but still queries WDQS, which
  # is right on its own and wrong inside a pipeline check: 1,200 pins at a
  # polite rate is an hour. A dry pipeline run proves the step is wired, not
  # that Wikidata is still there.
  budget="$WIKIDATA_BUDGET"
  [ -n "$DRY_RUN" ] && budget=5
  step "resolve to wikidata"        node --env-file="$ENV_FILE" scripts/resolve-wikidata.mjs --limit "$budget" $DRY_RUN

  note ""
  if [ ${#FAILED[@]} -eq 0 ]; then
    note "=== refresh finished clean $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  else
    # Loud, because a scheduled job that fails quietly is worse than one that
    # does not run: the data looks fresh and is not.
    note "=== refresh finished with ${#FAILED[@]} failed step(s): ${FAILED[*]}"
    exit 1
  fi
}

# flock is the whole concurrency story. -n so an overrun says so and leaves
# rather than queueing a second crawler behind the first.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  flock -n 9 || { echo "another refresh is still running ($LOCK) — skipping this slot"; exit 0; }
  main
else
  # macOS has no flock(1). mkdir is atomic on every filesystem we care about.
  if ! mkdir "$LOCK.d" 2>/dev/null; then
    echo "another refresh is still running ($LOCK.d) — skipping this slot"
    exit 0
  fi
  trap 'rmdir "$LOCK.d" 2>/dev/null' EXIT
  main
fi
