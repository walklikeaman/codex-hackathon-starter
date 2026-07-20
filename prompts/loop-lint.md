---
description: Lint / typecheck / build fix loop — run the project's check, fix what it flags with minimal diffs, repeat until clean. Run before every commit.
---

Start the 'Make it clean' loop. Goal: the project's lint/typecheck/build exits 0.
Max iterations: 8.

Step 0: Detect the check command from the project (pick the one that applies):
`npm run lint` · `npm run typecheck` · `tsc --noEmit` · `next build` ·
`eslint .` · `ruff check .` · `cargo check` · `go vet ./...`. If a `package.json`
`scripts` block names one, use that. State which command you're using.

Step 1: Run it. Read every error. Group by file.

Step 2: Fix with minimal diffs — fix only what's flagged, don't rewrite
surrounding code. Auto-fixers (`eslint --fix`, `ruff check --fix`) are fine, but
re-read each change.

Step 3: Re-run and verify. Continue only if errors remain.

Guardrails:

- Do NOT silence rules to force a pass (`// eslint-disable`, `# noqa`, `any`,
  `# type: ignore`) — fix the cause.
- Do NOT change the check command to make it pass.
- If an error needs a big refactor, report it — don't suppress it.
