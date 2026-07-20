#!/usr/bin/env bash
# hackathon-starter — one-command environment setup for an OpenAI Codex hackathon.
#
# ONE shared project: one GitHub repo, one Supabase database, one Vercel project.
# Most teammates need only Codex + CodeGraph locally and the shared repo. The
# person who manages the backend/deploy runs with --infra to wire Supabase/Vercel.
#
# Safe to re-run (idempotent). It never logs you in — auth stays in your hands.
#
# Usage:  ./setup.sh               # teammate: Codex + CodeGraph + skills (no DB/deploy accounts needed)
#         ./setup.sh --infra       # owner/backend: also install Vercel CLI + wire Supabase & Vercel MCP
#         ./setup.sh --playwright  # also wire the Playwright browser MCP (~100MB chromium)
#         ./setup.sh --check       # verify only, install nothing
set -uo pipefail

INFRA=0; PLAYWRIGHT=0; CHECK=0
for a in "$@"; do
  case "$a" in
    --infra)      INFRA=1;;
    --playwright) PLAYWRIGHT=1;;
    --check)      CHECK=1;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "unknown arg: $a"; exit 1;;
  esac
done

STARTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$1"; }
miss(){ printf '  \033[31m✗\033[0m %s\n' "$1"; }
have(){ command -v "$1" >/dev/null 2>&1; }

echo "▸ hackathon-starter setup  ($([ "$INFRA" = 1 ] && echo infra || echo teammate) · $([ "$CHECK" = 1 ] && echo check-only || echo install))"

# ── 0. Node 22+ (Codex + codegraph both need it) ───────────────────────────────
if have node; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$NODE_MAJOR" -ge 22 ]; then ok "node $(node --version)"; else
    miss "node $(node --version) — need >=22. Upgrade (nvm install 22) and re-run."; exit 1
  fi
else
  miss "node not found — install Node 22+ first (https://nodejs.org or nvm), then re-run."; exit 1
fi
have npm && ok "npm $(npm --version)" || { miss "npm not found"; exit 1; }

install_or_report(){ # name  check-cmd  install-cmd  docs
  local name="$1" chk="$2" inst="$3" docs="$4"
  if eval "$chk" >/dev/null 2>&1; then ok "$name already installed"; return 0; fi
  if [ "$CHECK" = 1 ]; then miss "$name missing — $docs"; return 1; fi
  echo "  • installing $name…"
  if eval "$inst"; then ok "$name installed"; else miss "$name install failed — do it by hand: $docs"; return 1; fi
}

# ── 1. Codex CLI ───────────────────────────────────────────────────────────────
install_or_report "Codex CLI" "command -v codex" \
  "npm install -g @openai/codex" \
  "npm i -g @openai/codex  (then: codex  → sign in)"

# ── 2. CodeGraph (local code knowledge graph, no external auth) ─────────────────
install_or_report "CodeGraph" "command -v codegraph" \
  "npm install -g @colbymchenry/codegraph" \
  "https://github.com/colbymchenry/codegraph"

# ── 3. Vercel CLI — only the person managing deploys needs it (--infra) ─────────
if [ "$INFRA" = 1 ]; then
  install_or_report "Vercel CLI" "command -v vercel" \
    "npm install -g vercel" \
    "npm i -g vercel  (then: vercel login)"
fi

[ "$CHECK" = 1 ] && { echo; echo "check done — nothing installed."; exit 0; }

# ── 3b. Make freshly-installed global bins resolvable in THIS shell ─────────────
GLOBAL_BIN="$(npm prefix -g 2>/dev/null)/bin"
case ":$PATH:" in *":$GLOBAL_BIN:"*) : ;; *) [ -d "$GLOBAL_BIN" ] && export PATH="$GLOBAL_BIN:$PATH";; esac

# ── 4. Wire CodeGraph into Codex (everyone — local, no auth) ────────────────────
if have codegraph; then
  echo "  • wiring CodeGraph into Codex…"
  codegraph install >/dev/null 2>&1 && ok "CodeGraph → Codex wired" \
    || warn "run 'codegraph install' yourself and pick Codex CLI"
fi

# ── 5. Wire Supabase + Vercel MCP — ONLY --infra (one person manages the shared project) ─
add_mcp(){ # name  <transport args...>
  local name="$1"; shift
  have codex || { warn "MCP $name skipped — Codex CLI not resolvable"; return 1; }
  local out; out="$(codex mcp add "$name" "$@" 2>&1)"
  if [ $? -eq 0 ]; then ok "MCP: $name"
  elif printf '%s' "$out" | grep -qiE 'exist|already'; then warn "MCP $name already present"
  else miss "MCP $name failed: $(printf '%s' "$out" | head -1)"; fi
}

if [ "$INFRA" = 1 ] && have codex; then
  echo "  • --infra: wiring Supabase + Vercel MCP (point these at the ONE shared project)…"
  add_mcp supabase --url "https://mcp.supabase.com/mcp"   # OAuth in-browser; pick the shared project
  add_mcp vercel   --url "https://mcp.vercel.com"          # OAuth in-browser; pick the shared project
elif [ "$INFRA" = 0 ]; then
  ok "teammate mode — no Supabase/Vercel MCP (you use the shared DB via .env; deploys come from the shared Vercel)"
fi
# Playwright — opt-in for anyone verifying the demo path in a real browser.
[ "$PLAYWRIGHT" = 1 ] && have codex && add_mcp playwright -- npx -y @playwright/mcp@latest

# ── 6. Install the /ship + loop prompts into Codex (everyone) ───────────────────
mkdir -p "$HOME/.codex/prompts"
if cp "$STARTER_DIR"/prompts/*.md "$HOME/.codex/prompts/" 2>/dev/null; then
  ok "prompts → ~/.codex/prompts/ (/ship, /loop-demo, /loop-lint, …)"
else
  warn "no prompts/ copied"
fi

# ── 7. Guardrail SessionStart hook (already in .codex/hooks.json) ──────────────
[ -f "$STARTER_DIR/.codex/hooks.json" ] && ok ".codex/hooks.json present (guardrail + scope check on session start)"

# ── 8. Closing banner — loud if wiring couldn't run ────────────────────────────
echo
if have codex && have codegraph; then
  echo "✅ Setup done. Next:"
else
  echo "⚠️  CLIs installed but not resolvable in THIS shell — wiring was skipped."
  echo "   Open a NEW terminal and re-run ./setup.sh, then:"
fi
cat <<EOF
   1. Sign in to Codex:   codex        (first run walks you through it)
   2. Copy .env.example → .env.local and paste the SHARED Supabase keys (ask the owner).
   3. Scaffold your app:  ./scaffold.sh  (or your own stack), then in the app dir:
                          codegraph init   (build the local code index)
   4. Open the repo with Codex, fill the **Project** block in AGENTS.md, and build.
      Push a branch → the shared Vercel deploys a preview.  /ship to save.
$( [ "$INFRA" = 1 ] && echo "   (infra) You wired Supabase + Vercel MCP — sign in to each and pick the ONE shared project." )

   Full checklist: INSTALL.md   ·   what/why: README.md   ·   come-prepared: PREFLIGHT.md
EOF
