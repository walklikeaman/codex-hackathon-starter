---
description: Persist the current batch of changes — stage surgically, write a clean commit, push, verify remote. Keeps the repo demo-ready.
---

# /ship — save and push the current batch

You finished a working slice. Persist it so the next teammate pulls green code
and the repo stays demo-ready. Be thorough but surgical. Under time pressure the
failure mode is a leaked secret or a broken `main` — this guards both.

## Steps (stop and ask if anything is ambiguous)

### 1. Diagnose

```bash
git status --short
git log --oneline -5
git diff --stat | tail -20
```

Identify what changed. Flag anything dangerous (`.env`, `*.key`, tokens, real
personal data) → STOP and ask before staging.

### 2. Stage surgically — explicit paths only, NEVER `-A` / `.`

```bash
git add path/to/file another/file
git diff --cached --stat
```

Confirm: no `.env`, no keys, no scratch `_probe_*`/temp files (delete those first).

### 3. Commit (temp file avoids quoting pain)

```bash
cat > /tmp/commit-msg.txt <<'EOF'
<subject, present tense, <=72 chars>

<why, not what — 1-2 lines>

Co-Authored-By: Codex <noreply@openai.com>
EOF
git commit -F /tmp/commit-msg.txt
```

### 4. Push

```bash
git push origin HEAD
```

Not on `main`? Push the branch; open a PR only if the team works that way.

### 5. Verify remote is in sync

```bash
LOCAL=$(git rev-parse HEAD)
git fetch -q origin
REMOTE=$(git rev-parse "@{u}" 2>/dev/null)
[ "$LOCAL" = "$REMOTE" ] && echo "✓ remote in sync" || echo "✗ remote drift — push again"
```

### 6. Report — one line: subject · short hash · sync ✓/✗.

## Hard rules

- NEVER `git add -A` / `git add .`.
- NEVER commit `.env`, keys, or live personal data.
- NEVER `--no-verify` unless asked — fix the hook failure instead.
- NEVER force-push a shared branch without an explicit OK.
- Nothing worth shipping? Say so — no empty commits.
