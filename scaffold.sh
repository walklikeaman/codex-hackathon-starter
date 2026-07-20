#!/usr/bin/env bash
# scaffold.sh — drop a runnable app into this starter so CodeGraph/Vercel/loop-demo
# have something to work on immediately. Default: Next.js + TS + Tailwind in ./app.
# Swap this out for any stack — the starter's AGENTS.md/guardrails at the root still
# apply (Codex merges AGENTS.md up the tree; run it from the app subfolder).
#
# Usage:  ./scaffold.sh [dir]          # default dir: app
set -uo pipefail
APP="${1:-app}"

if [ -e "$APP" ]; then
  echo "✗ '$APP' already exists — pass a different dir name, or delete it first."; exit 1
fi

echo "▸ scaffolding Next.js app in ./$APP  (this pulls packages — do it the day before if you can)"
npx create-next-app@latest "$APP" \
  --ts --app --tailwind --eslint --use-npm --no-src-dir --import-alias "@/*" --yes || {
    echo "✗ create-next-app failed — check Node 22+ and network."; exit 1; }

# seed local env from the template (never overwrite an existing one)
[ -f .env.example ] && [ ! -f "$APP/.env.local" ] && cp .env.example "$APP/.env.local" \
  && echo "  ✓ $APP/.env.local seeded from .env.example — fill it in (it's gitignored)"

cat <<EOF

✅ App ready in ./$APP. Next:
   cd $APP
   codegraph init          # build the local code index for Codex
   npm run dev             # http://localhost:3000
   vercel                  # first preview deploy (grab the URL for your demo)
EOF
