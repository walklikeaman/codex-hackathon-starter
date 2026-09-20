#!/usr/bin/env bash
#
# Keep the Wikipedia enrichment going for the sixty hours it takes.
#
#   bash scripts/enrich-loop.sh [--limit 5500]
#
# The run itself has always been resumable — `wikipedia_enriched_at` is stamped per
# work, so starting it again continues rather than repeats — but nothing ever started
# it again. Three different endings have already cost this job a stretch of days, and
# every one of them is survivable by simply running the script once more:
#
#   * the machine rebooted (16.09), and the run and its /tmp log went with it;
#   * the laptop slept, and six network failures in a row put the run into its own
#     outage wait, which is correct and still leaves it stopped if the sleep outlasts it;
#   * Wikidata's replicas fell ~500s behind (20.09) — five maxlag retries are
#     30+60+90+120+150s, and a lag deeper than that throws on the FIRST request,
#     before a single work has been read.
#
# The only ending that means "finished" is the script's own "Nothing to enrich.",
# printed when the query returns no unstamped work. Anything else is a pause.
#
# The env file is the one in the glorymap-modules-integration worktree, not the
# repository root's: the root file has no SUPABASE_SERVICE_ROLE_KEY, and its
# OPENAI_API_KEY would quietly move extraction onto a different model. See
# wiki/handoff.md.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${LOG:-$HOME/enrich.log}"

# **The env file is the one that can write, not the one that is nearest.** The clone and
# every worktree carry a `.env.local`, they do not hold the same keys, and the one in the
# repository root holds no service key at all. So the key is the test, not a path somebody
# has to remember — and the key is tested for the PROJECT it belongs to, because there is a
# second Supabase project on this account whose service key would connect, write, and say
# nothing (see wiki/handoff.md).
same_project() {
  local file="$1" ref key
  ref=$(sed -nE 's#^NEXT_PUBLIC_SUPABASE_URL=https://([a-z0-9]+)\.supabase\.co.*#\1#p' "$file" | head -1)
  key=$(sed -nE 's/^SUPABASE_SERVICE_ROLE_KEY=(.+)/\1/p' "$file" | head -1)
  [ -n "$ref" ] && [ -n "$key" ] || return 1
  case "$key" in
    eyJ*.*.*) : ;;
    sb_secret_*) return 0 ;;   # the new format carries no ref; nothing offline can check it
    *) return 1 ;;
  esac
  python3 -c "
import base64, json, sys
raw = sys.argv[1].split('.')[1].replace('-', '+').replace('_', '/')
raw += '=' * (-len(raw) % 4)
try:
    claims = json.loads(base64.b64decode(raw))
except Exception:
    sys.exit(1)
sys.exit(0 if claims.get('role') == 'service_role' and claims.get('ref') == sys.argv[2] else 1)
" "$key" "$ref"
}

if [ -z "${ENV_FILE:-}" ]; then
  for candidate in \
    "$ROOT/.env.local" \
    "$ROOT/../glorymap-modules-integration-2296ab/.env.local" \
    "$ROOT"/../*/.env.local \
    "$ROOT"/.claude/worktrees/*/.env.local
  do
    [ -f "$candidate" ] || continue
    same_project "$candidate" || continue
    ENV_FILE="$candidate"
    break
  done
fi
ENV_FILE="${ENV_FILE:-}"
[ -n "$ENV_FILE" ] || { echo "no .env.local with a SUPABASE_SERVICE_ROLE_KEY anywhere under $ROOT" >&2; exit 1; }
GAP_SECONDS="${GAP_SECONDS:-120}"
# A run that dies faster than this did not do any work, so it is a configuration
# problem rather than a passing one. Enough of those in a row and looping is just a
# hot loop against a wall.
TOO_FAST_SECONDS=90
GIVE_UP_AFTER=10

[ -f "$ENV_FILE" ] || { echo "no env file at $ENV_FILE" >&2; exit 1; }
cd "$ROOT"

fast_failures=0
while true; do
  printf '\n===== attempt %s — %s %s =====\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$ENV_FILE" "$*" >> "$LOG"
  started=$(date +%s)
  node --env-file="$ENV_FILE" scripts/enrich-from-wikipedia.mjs "$@" >> "$LOG" 2>&1
  status=$?
  elapsed=$(( $(date +%s) - started ))

  if [ "$status" -eq 0 ] && tail -40 "$LOG" | grep -q "Nothing to enrich."; then
    printf '===== finished %s: nothing left to enrich =====\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$LOG"
    exit 0
  fi

  if [ "$elapsed" -lt "$TOO_FAST_SECONDS" ]; then
    fast_failures=$(( fast_failures + 1 ))
  else
    fast_failures=0
  fi
  if [ "$fast_failures" -ge "$GIVE_UP_AFTER" ]; then
    printf '===== giving up %s: %s runs in a row ended within %ss — this is configuration, not weather =====\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$fast_failures" "$TOO_FAST_SECONDS" >> "$LOG"
    exit 1
  fi

  printf '===== attempt ended after %ss with status %s — again in %ss =====\n' \
    "$elapsed" "$status" "$GAP_SECONDS" >> "$LOG"
  sleep "$GAP_SECONDS"
done
