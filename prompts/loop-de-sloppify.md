---
description: Post-implementation cleanup pass — remove debug logs, commented code, TODO hacks, naming inconsistencies, and dead branches before committing. Run after every implementation, before /ship.
---

Start the 'De-Sloppify Pass' loop. Goal: the diff is clean — no debug code, no dead branches, no naming drift, no probe artifacts. Max iterations: 4. Between iterations run: `git diff HEAD --stat && git status --short`. Exit when: review finds no slop and the diff is clean.

Step 1: Review the recent changes for these specific items:
- Debug `print()` / `debugPrint()` / `console.log()` / `logger.debug()` calls added during development
- Commented-out code blocks
- TODO / FIXME / HACK comments that were meant to be temporary
- Oversized functions that could be split (>40 lines added in one go)
- Inconsistent naming (camelCase vs snake_case drift, abbreviations vs full words)
- Probe scripts, scratch files, or test fixtures that should not be committed
- Variables or imports that YOUR changes made unused

Step 2: Apply minimal fixes — delete dead code, extract helpers only when it genuinely reduces repetition, align naming to the surrounding file style.

Step 3: Verify the fix didn't break anything. In the project: `git status --short` and a quick re-read of the changed files. Do not run heavy test suites here — that's for loop-lint and loop-e2e.

Step 4: Self-pace. Continue only if slop remains.

**Guardrail rules:**
- Touch only what YOUR changes introduced — do not clean up pre-existing code.
- Do not refactor things that aren't broken.
- Every changed line must trace directly to removing slop, not to general cleanup.
- Never delete probe scripts that are still needed for investigation — finish investigating first.
