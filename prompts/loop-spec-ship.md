---
description: Spec-driven implementation — read spec.md, implement requirements one at a time, mark each done, repeat until all are complete. Use at the start of any multi-requirement task.
argument-hint: "[path to spec file, default: spec.md]"
---

Start the 'Spec-First Ship' loop. Goal: every requirement in spec.md is implemented and marked `[x]`. Max iterations: 15. Between iterations run: `grep -E '^\- \[.\]' "${ARGS:-spec.md}" | head -20`. Exit when: no unchecked `- [ ]` requirements remain.

Step 1: Read `${ARGS:-spec.md}`. Select the first unchecked requirement (`- [ ]`). If no spec.md exists, stop and ask the operator to write one before continuing.

Step 2: Implement exactly that one requirement with appropriate code and — where relevant — a test. Verify it works before marking it done. In the project, verification means: the changed behaviour is observable (wiki page updated, script runs, API call returns expected result).

Step 3: Mark the requirement complete in spec.md: change `- [ ]` → `- [x]`. Commit or checkpoint if meaningful.

Step 4: Self-pace. Read the check output, verify the exit condition, and continue with the next unchecked requirement.

**Guardrail rules:**
- One requirement per iteration — do not skip ahead or batch multiple requirements.
- Mark done only AFTER verification, not before.
- Do not modify the success criteria of a requirement to make it easier.
- If a requirement is ambiguous, stop and ask before implementing.
- Never mark `[x]` on a requirement you haven't verified.
