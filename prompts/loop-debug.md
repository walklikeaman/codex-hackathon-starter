---
description: Reflexion debug loop — reproduce a failing test or script, log each failed attempt to .loops/reflexion.md, then apply a different fix each time. Use when a bug has resisted one fix attempt already.
argument-hint: "<failing test name or script path>"
---

Start the 'Reflexion Debug Loop'. Goal: the failing test or script passes. Max iterations: 8. Between iterations run: `python "$ARGS" 2>&1 | tail -20` (for scripts) or the specific failing test command you identify. Exit when: the repro exits 0.

Step 1: Reproduce the bug. Run the failing test / script and capture the full error output.

Step 2: If it fails, append a reflection to `.loops/reflexion.md` in this format before trying a new fix:
```
### Attempt N — [date]
What tried: <approach>
What failed: <exact error / symptom>
Hypothesis for next attempt: <why this might be different>
```

Step 3: Read the full `.loops/reflexion.md` to see all prior attempts. Implement a fix that is genuinely different from every prior attempt — prioritise root cause, not workarounds.

Step 4: Self-pace. Re-run the check, re-read the output, continue only if the exit condition is not met.

**Guardrail rules:**
- Never delete a reflexion entry — the log is the memory.
- Do not modify the failing test to force a pass.
- If 8 iterations complete without success, write a final hypothesis entry in reflexion.md and report the blocker.
- Clear reflexion.md at the START of a new, unrelated debug session (not mid-session).
