---
description: Learn from repeated failures — when a check fails the same way twice, write a constraint to .loops/guardrails.md so future iterations avoid it. Run whenever you are about to retry a failing operation more than once.
---

Start the 'Guardrails Learning Loop'. Goal: the current check passes without repeating prior failure patterns. Max iterations: 12. Between iterations run: `git status --short && cat .loops/guardrails.md 2>/dev/null | tail -20`. Exit when: the check passes cleanly.

Step 1: Read `.loops/guardrails.md` and treat every recorded constraint as a hard rule for this session.

Step 2: Execute the relevant check command for whatever you are working on (tests, lint, API call, wiki lint, git operation). If it fails identically to a previous attempt, append a new "## Guardrail:" entry to `.loops/guardrails.md` describing what failed and how to avoid it — then apply a fix that honours all recorded guardrails.

Step 3: Self-pace. After each iteration, re-read `.loops/guardrails.md` and the check output. Only continue if the exit condition is not met.

**Guardrail rules (never break these):**
- Do not modify the check command or exit criteria to force a pass.
- Do not skip checks or stub them out.
- If genuinely blocked after 12 iterations, write the blocker as a guardrail entry and report — do not game the metric.
- Guardrail entries are permanent project knowledge — never delete them.
