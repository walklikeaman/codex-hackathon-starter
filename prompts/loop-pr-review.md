---
description: Three-pass self-review of the current branch diff before opening a PR — catches bugs, edge cases, naming issues, and missing wiki updates. Run before every PR.
---

Start the 'PR Self-Review' loop. Goal: three clean self-review passes on the current diff with no critical findings. Max iterations: 3. Between iterations run: `git diff main...HEAD --stat && git log main...HEAD --oneline`. Exit when: three passes complete with no critical findings remaining.

Step 1 (pass 1 — correctness): Review the full diff with `git diff main...HEAD`. Look for: logic errors, missing null checks, wrong variable names, hardcoded values that should be config, security issues (credentials, paths, injection), missing wiki/log.md entries for meaningful changes.

Step 2 (pass 2 — completeness): Check for: tests missing for new code, stale comments, dead code introduced by the change, TODO hacks that need resolution before ship, probe/scratch files that should be deleted.

Step 3 (pass 3 — style/wiki): Check for: naming inconsistencies, formatting drift, CLAUDE.md rules violated, wiki pages that need updating, cross-links missing.

Apply fixes for each finding before the next pass. After three clean passes, report a summary of what was found and fixed.

**Guardrail rules:**
- Three passes means three full diff reviews — not one review split into three.
- Do not skip a pass because "it looks clean."
- Critical findings must be fixed before reporting done — do not just list them.
- Never use `git add -A`. Never commit probe scripts or secrets.
