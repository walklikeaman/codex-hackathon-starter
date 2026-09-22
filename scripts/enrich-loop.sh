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

# So that the installer can ask which file this would use instead of re-implementing the
# question and drifting from the answer.
if [ "${1:-}" = "--print-env-file" ]; then printf '%s\n' "$ENV_FILE"; exit 0; fi
GAP_SECONDS="${GAP_SECONDS:-120}"
# A run that dies faster than this did not do any work, so it is a configuration
# problem rather than a passing one. Enough of those in a row and looping is just a
# hot loop against a wall.
TOO_FAST_SECONDS=90
# The run's own "come back after the model's daily allowance resets" status.
QUOTA_SPENT_EXIT=75
GIVE_UP_AFTER=10

[ -f "$ENV_FILE" ] || { echo "no env file at $ENV_FILE" >&2; exit 1; }
cd "$ROOT"

# **One of these at a time, or the catalogue is read twice.** The work list is chosen once
# per attempt — every unstamped work, ordered by id — so a second copy takes the same list,
# spends the same rate limit on the same articles, and races the first one to the stamp.
# That becomes easy to do by accident the moment this is also started at login: the agent
# has one, and the hand that types the command has another.
#
# `mkdir` is the lock because it is atomic and needs no tool macOS might not ship. A stale
# lock is recognised by asking whether that pid is still THIS script rather than merely
# alive — a pid is reused, and a reboot reuses low ones freely.
LOCK="${LOCK:-$HOME/.glorymap-enrich.lock}"
take_the_lock() {
  if mkdir "$LOCK" 2>/dev/null; then return 0; fi
  local held
  held=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$held" ] && ps -p "$held" -o command= 2>/dev/null | grep -q "enrich-loop.sh"; then
    return 1
  fi
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null
}
if ! take_the_lock; then
  echo "already running as pid $(cat "$LOCK/pid" 2>/dev/null) — nothing to do" >&2
  exit 0
fi
printf '%s\n' "$$" > "$LOCK/pid"

# **A signal must stop this, and by default it does not.** bash defers a trap until the
# foreground command finishes, so `kill <supervisor>` on a run that is mid-work does
# nothing visible for as long as that work takes — and the pid is still there afterwards,
# which reads as "the TERM was ignored". Measured: 35 seconds after a TERM, both the
# supervisor and its node child were still running.
#
# So node runs in the background and is waited on. The trap then fires at once, and it
# takes the child with it: killing the supervisor alone would leave an orphan reading
# Wikipedia and stamping works with nothing watching it.
child=""
stop() {
  [ -n "$child" ] && kill "$child" 2>/dev/null
  rm -rf "$LOCK"
}
trap 'stop; exit 143' INT TERM
trap 'stop' EXIT

fast_failures=0
while true; do
  printf '\n===== attempt %s — %s %s =====\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$ENV_FILE" "$*" >> "$LOG"
  started=$(date +%s)
  node --env-file="$ENV_FILE" scripts/enrich-from-wikipedia.mjs "$@" >> "$LOG" 2>&1 &
  child=$!
  wait "$child"
  status=$?
  child=""
  elapsed=$(( $(date +%s) - started ))

  if [ "$status" -eq 0 ] && tail -40 "$LOG" | grep -q "Nothing to enrich."; then
    printf '===== finished %s: nothing left to enrich =====\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$LOG"
    exit 0
  fi

  # **The model's daily allowance is spent** (status 75, see dailyQuotaSpent). Not a failure
  # and not a reason to go round again in two minutes: every call until the reset gets the
  # same refusal, and every work read meanwhile is a Wikipedia fetch thrown away. Wait for
  # 00:05 UTC. If a run started after that is refused again within half an hour, the reset
  # has not happened where we assumed it would — wait an hour and ask again, rather than a
  # whole day on a guess.
  if [ "$status" -eq "$QUOTA_SPENT_EXIT" ]; then
    now=$(date -u +%s)
    if [ "$elapsed" -lt 1800 ] && [ "${quota_waited:-0}" -eq 1 ]; then
      wait_s=3600
    else
      next_reset=$(( (now / 86400 + 1) * 86400 + 300 ))
      wait_s=$(( next_reset - now ))
    fi
    quota_waited=1
    fast_failures=0
    printf '===== the model quota is spent after %ss — waiting %ss, until %s =====\n' \
      "$elapsed" "$wait_s" "$(date -u -r $(( now + wait_s )) '+%Y-%m-%dT%H:%M:%SZ')" >> "$LOG"
    sleep "$wait_s" &
    child=$!
    wait "$child"
    child=""
    continue
  fi
  quota_waited=0

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
  # Backgrounded for the same reason as the run itself: a TERM during the gap should stop
  # this now, not in two minutes.
  sleep "$GAP_SECONDS" &
  child=$!
  wait "$child"
  child=""
done
