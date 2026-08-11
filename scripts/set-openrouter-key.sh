#!/usr/bin/env bash
#
# Paste the OpenRouter key, press Enter, done.
#
#   bash scripts/set-openrouter-key.sh
#
# Asks once, checks the key against OpenRouter, writes it to .env.local and
# exits. Nothing stays open and nothing is left running.
#
# The key is typed into a hidden prompt: never echoed to the screen, never a
# command-line argument (which would put it in `ps` output and in shell
# history), and .env.local is gitignored.
#
# A key that OpenRouter rejects is taken back out of the file, because a bad
# value left behind would satisfy the "already set" check and make every later
# run fail with no way to enter a different one.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
cd "$ROOT"

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "no $ENV_FILE — copy .env.example to .env.local first"

if grep -qE '^OPENROUTER_API_KEY=.+' "$ENV_FILE"; then
  say "OPENROUTER_API_KEY is already in .env.local"
  echo "  Delete that line first if you want to replace it."
  exit 0
fi

say "Paste the OpenRouter key and press Enter"
echo "  Get one at https://openrouter.ai/settings/keys — the free tier is enough."
echo "  Nothing will appear as you paste. That is expected."
printf '  key: '
read -rs KEY
echo

[ -n "${KEY:-}" ] || die "nothing entered"
case "$KEY" in
  *[[:space:]]*) die "the key contains a space or a newline — copy it again as one unbroken string" ;;
  sk-or-v1-*)    ;;
  *)             die "an OpenRouter key starts with sk-or-v1- (this one starts \"${KEY:0:8}\")" ;;
esac
case "$KEY" in *YOUR-*|*your-*) die "that is the placeholder from .env.example, not a key" ;; esac

say "Checking the key with OpenRouter"
# /api/v1/key answers with the key's own limits, so this proves the key works
# without spending a single token on a completion.
HTTP=$(curl -s -o /tmp/or-check.json -w '%{http_code}' \
  -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/key || echo 000)

if [ "$HTTP" != "200" ]; then
  printf '  OpenRouter answered %s: ' "$HTTP"
  python3 -c 'import json,sys; d=json.load(open("/tmp/or-check.json")); print(d.get("error",{}).get("message", d))' 2>/dev/null \
    || echo "(no readable response)"
  rm -f /tmp/or-check.json
  die "the key was not accepted — check you copied it whole from the OpenRouter dashboard"
fi

python3 - <<'PY' || true
import json
d = json.load(open("/tmp/or-check.json")).get("data", {})
limit, used = d.get("limit"), d.get("usage")
print(f"  accepted — label {d.get('label') or 'unnamed'}, "
      f"used ${used or 0}, limit {'none' if limit is None else '$' + str(limit)}")
if d.get("is_free_tier"): print("  free tier: the models ending in :free cost nothing")
PY
rm -f /tmp/or-check.json

# Keep the file's own permissions and append one line. The model name is written
# too, so a later run does not depend on remembering which model was verified.
[ -s "$ENV_FILE" ] && [ "$(tail -c1 "$ENV_FILE" | wc -l)" -eq 0 ] && echo >> "$ENV_FILE"
printf 'OPENROUTER_API_KEY=%s\n' "$KEY" >> "$ENV_FILE"
grep -qE '^OPENROUTER_MODEL=' "$ENV_FILE" \
  || printf 'OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free\n' >> "$ENV_FILE"
unset KEY
chmod 600 "$ENV_FILE"

say "Done"
ok  "  OPENROUTER_API_KEY written to .env.local (gitignored, chmod 600)"
echo "  Nothing else is running. You can close this window."
