#!/usr/bin/env bash
#
# Paste the Supabase service_role key, press Enter, done.
#
#   bash scripts/set-supabase-service-key.sh
#
# The twin of set-openrouter-key.sh, and it exists for the same reason: the key
# is typed into a hidden prompt, so it is never echoed, never a command-line
# argument (which would put it in `ps` and in shell history), and .env.local is
# gitignored and left at chmod 600.
#
# **It checks the key belongs to THIS project.** There is more than one Supabase
# project on this account, and a service key from the wrong one does not fail —
# it connects, it writes, and the rows land in the other project's production.
# A legacy service_role key is a JWT carrying its own project ref, so that check
# is free and happens before anything is written.
#
# A key that cannot write is taken back out of the file. A bad value left behind
# satisfies the "already set" check and makes every later run fail with no
# obvious way to enter a different one.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
cd "$ROOT"

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "no $ENV_FILE — copy .env.example to .env.local first"

if grep -qE '^SUPABASE_SERVICE_ROLE_KEY=.+' "$ENV_FILE"; then
  say "SUPABASE_SERVICE_ROLE_KEY is already in .env.local"
  echo "  Delete that line first if you want to replace it."
  exit 0
fi

PROJECT_URL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
PROJECT_REF=$(printf '%s' "$PROJECT_URL" | sed -nE 's#https://([a-z0-9]+)\.supabase\.co.*#\1#p')
[ -n "$PROJECT_REF" ] || die "could not read a project ref out of NEXT_PUBLIC_SUPABASE_URL"

say "Paste the service_role key for project $PROJECT_REF and press Enter"
echo "  Supabase dashboard → Project Settings → API Keys."
echo "  NOT the JWT Keys page: that one holds the signing keys, not this."
echo "  Take the key labelled service_role (or a Secret key, sb_secret_…)."
echo "  Nothing will appear as you paste. That is expected."
printf '  key: '
read -rs KEY
echo

[ -n "${KEY:-}" ] || die "nothing entered"
case "$KEY" in
  *[[:space:]]*) die "the key contains a space or a newline — copy it again as one unbroken string" ;;
esac
case "$KEY" in *YOUR-*|*your-*) die "that is a placeholder, not a key" ;; esac

# A legacy service_role key is a JWT and says which project and which role it is
# for. Both are checked here, offline, before the value touches the file.
case "$KEY" in
  eyJ*.*.*)
    PAYLOAD=$(printf '%s' "$KEY" | cut -d. -f2)
    # base64url, and padded back to a multiple of four so python will decode it.
    CLAIMS=$(python3 -c "
import base64, json, sys
raw = sys.argv[1].replace('-', '+').replace('_', '/')
raw += '=' * (-len(raw) % 4)
try:
    d = json.loads(base64.b64decode(raw))
except Exception:
    print('UNREADABLE'); raise SystemExit
print(f\"{d.get('role','?')} {d.get('ref','?')}\")
" "$PAYLOAD")
    [ "$CLAIMS" = "UNREADABLE" ] && die "that looks like a JWT but its payload could not be read"
    ROLE=${CLAIMS%% *}
    REF=${CLAIMS##* }
    [ "$ROLE" = "service_role" ] || die "this key's role is \"$ROLE\", not service_role — the anon key cannot write"
    if [ "$REF" != "$PROJECT_REF" ]; then
      die "this key belongs to project \"$REF\" but .env.local points at \"$PROJECT_REF\".
  There is more than one project on this account. Writing with the wrong key
  puts rows in the other project's production and nothing would have said so."
    fi
    ok "  key is service_role for $PROJECT_REF"
    ;;
  sb_secret_*)
    # The new format carries no project ref; the write test below is the check.
    ok "  secret key (new format) — the write test below is what proves the project"
    ;;
  *)
    die "a service key is either a JWT starting eyJ or a secret starting sb_secret_ (this one starts \"${KEY:0:8}\")"
    ;;
esac

[ -s "$ENV_FILE" ] && [ "$(tail -c1 "$ENV_FILE" | wc -l)" -eq 0 ] && echo >> "$ENV_FILE"
printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$KEY" >> "$ENV_FILE"
unset KEY
chmod 600 "$ENV_FILE"

say "Checking it can actually write"
# The existing checker, which tests a WRITE — a select passes with the anon key
# too, so reading proves nothing.
if node --env-file=.env.local scripts/check-service-key.mjs; then
  say "Done"
  ok  "  SUPABASE_SERVICE_ROLE_KEY written to .env.local (gitignored, chmod 600)"
else
  # Taken back out, for the reason at the top of this file.
  python3 - "$ENV_FILE" <<'PY'
import io, sys
p = sys.argv[1]
lines = io.open(p, encoding="utf8").read().splitlines(keepends=True)
io.open(p, "w", encoding="utf8").writelines(
    l for l in lines if not l.startswith("SUPABASE_SERVICE_ROLE_KEY="))
PY
  die "the key could not write — removed from .env.local so you can try another"
fi
