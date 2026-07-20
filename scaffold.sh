#!/usr/bin/env bash
# scaffold.sh — the runnable Next.js app already lives in this repo (root: package.json + app/).
# This just installs its dependencies and seeds the local .env.local from .env.example.
#
# Usage:  ./scaffold.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# seed local env (never overwrite an existing one) — keys are already in .env.example
if [ ! -f .env.local ]; then
  cp .env.example .env.local && echo "  ✓ .env.local создан из .env.example (общие ключи Supabase уже внутри)"
fi

echo "▸ ставлю зависимости приложения…"
npm install --no-audit --no-fund

cat <<EOF

✅ Готово. Дальше:
   npm run dev     # http://localhost:3000
   codegraph init  # собрать индекс кода для Codex
EOF
