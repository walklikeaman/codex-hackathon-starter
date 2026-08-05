#!/usr/bin/env bash
#
# Put the Supabase service role key in place, then finish the MovieMaps ingest.
#
#   bash scripts/finish-moviemaps-ingest.sh
#
# The key is typed straight into this script and goes into .env.local. It is
# never echoed, never passed as a command-line argument (which would put it in
# `ps` output and in shell history), and .env.local is gitignored.
#
# Everything here is idempotent. Works insert with ON CONFLICT DO NOTHING and
# submissions upsert on (work_id, place_key), so a second run changes nothing and
# an interrupted run can simply be repeated.
#
# Get the key: Supabase Dashboard → your project → Settings → API → service_role.
# It is a secret with full read/write access that bypasses row-level security.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
cd "$ROOT"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
[ -f "$ENV_FILE" ] || die "no $ENV_FILE — copy .env.example first"
[ -f "$ROOT/data/moviemaps/movies.ndjson" ] || die \
  "no data/moviemaps/movies.ndjson — harvest first:
   tools/scraperai/.venv/bin/python tools/scraperai/harvest.py"

# ---------------------------------------------------------------- the key
if grep -qE '^SUPABASE_SERVICE_ROLE_KEY=.+' "$ENV_FILE"; then
  say "SUPABASE_SERVICE_ROLE_KEY already in .env.local — using it"
else
  # The line usually already exists, commented out and holding the .env.example
  # placeholder. That reads as "the key is set" at a glance and is why this
  # replaces the line in place instead of appending a second one — two
  # definitions of the same variable is a worse state than none.
  if grep -qE '^# *SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE"; then
    say "Found SUPABASE_SERVICE_ROLE_KEY commented out with a placeholder — replacing it"
  else
    say "Paste the service_role key (input is hidden, nothing is echoed)"
  fi
  echo "  Supabase Dashboard → Settings → API → service_role"
  printf '  key: '
  read -rs SERVICE_KEY
  echo

  [ -n "${SERVICE_KEY:-}" ] || die "nothing entered"
  # Both shapes are current: legacy JWTs start eyJ, new secret keys sb_secret_.
  case "$SERVICE_KEY" in
    eyJ*|sb_secret_*) ;;
    *) die "that does not look like a service_role key (expected eyJ… or sb_secret_…)" ;;
  esac
  case "$SERVICE_KEY" in
    *YOUR-*|*your-*) die "that is the placeholder from .env.example, not a key" ;;
  esac
  # The anon key is the one people grab by mistake; it cannot write, and the
  # failure would surface later as a confusing row-level-security error.
  if grep -qF "$SERVICE_KEY" "$ENV_FILE"; then
    die "that key is already in .env.local under another name — you pasted the anon key"
  fi

  TMP="$(mktemp)"
  # Drop any commented or placeholder definition, then write the real one.
  grep -vE '^# *SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" > "$TMP"
  [ -s "$TMP" ] && [ "$(tail -c1 "$TMP" | wc -l)" -eq 0 ] && echo >> "$TMP"
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SERVICE_KEY" >> "$TMP"
  # Keep the file's permissions rather than mktemp's, and never leave it
  # world-readable.
  cat "$TMP" > "$ENV_FILE"
  rm -f "$TMP"
  chmod 600 "$ENV_FILE"
  unset SERVICE_KEY
  JUST_WRITTEN=1
  echo "  written to .env.local (gitignored, chmod 600)"
fi

# If the key we just wrote turns out to be wrong, take it back out. Left in
# place it would satisfy the "already set" branch above, and every re-run would
# fail with no way to type a different one.
rollback_key() {
  if [ "${JUST_WRITTEN:-0}" = "1" ]; then
    TMP="$(mktemp)"
    grep -vE '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" > "$TMP"
    cat "$TMP" > "$ENV_FILE"
    rm -f "$TMP"
    echo "  removed it from .env.local — run this again to enter another"
  fi
}

# Fail here rather than halfway through a 6,029-row insert.
say "Checking the key can write"
node --env-file=.env.local "$ROOT/scripts/check-service-key.mjs" \
  || { rollback_key; die "the key was not accepted — see the reason above"; }

# ---------------------------------------------------------------- the run
say "Step 1/3 — what would be created (nothing written yet)"
node --env-file=.env.local scripts/ingest-moviemaps-works.mjs --dry-run

say "Step 2/3 — creating works"
node --env-file=.env.local scripts/ingest-moviemaps-works.mjs

say "Step 3/3 — queueing locations as pending submissions"
node --env-file=.env.local scripts/ingest-moviemaps.mjs

say "Done. What landed:"
node --env-file=.env.local -e '
const { createClient } = await import("@supabase/supabase-js");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const count = async (table, column, value) => {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  if (error) throw new Error(error.message);
  return count;
};
console.log(`  works from the scrape: ${await count("works", "source", "moviemaps")}`);
console.log(`  submissions pending:   ${await count("location_submissions", "source_kind", "moviemaps")}`);
'
