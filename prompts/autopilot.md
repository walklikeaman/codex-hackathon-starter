---
description: Bounded autopilot — drive ONE well-specified task to verified-green on your own (spec → build → run → verify → /ship to your branch), then STOP at the human gate. Autonomy up to the gate, never through it.
---

# /autopilot — drive the task yourself to green, stop at the gate

One command that says "do this yourself." It runs the task through the loop autonomously and
**stops at the human gate** — it doesn't merge into `main`, doesn't deploy to prod,
doesn't decide on the team's behalf. Autonomy UP TO the gate, but never through it.

## Loop (one task)

1. **Spec** — rewrite the whole task: Goal / Now / Need / How / Done-when.
   Gate on the spec: if you couldn't hand it to a fresh agent and have them execute it — sharpen it before you code.
2. **Implementation** — on your own branch (`feature/<name>`), surgically, the simplest way.
   If the code already exists — ask CodeGraph for the structure, don't grep blindly.
3. **Verify by running** — run it for real: lint/build clean (`/loop-lint`),
   demo path green (`/loop-demo`). Not "should work," but you opened the result and confirmed it.
4. **Checkpoint** — `/ship` to YOUR branch (surgical staging, clean commit, push), open a PR.
5. **STOP + report.** End the turn with a report (below). Don't merge, don't deploy to prod, don't send anything.

Long/multi-file task → offload steps 2–3 into a separate session or a wave of agents,
and return only the output to the main thread (context-rot hygiene).

## Hard stops — autopilot does NOT cross these on its own

- **Merge into `main`** — that's the integrator, via a PR.
- **Deploy to the prod domain, sending anything outward, spending money.**
- **DB schema / tables while the idea isn't locked** — decide this in the first 15 minutes of kickoff.
- **A product or design decision that's a matter of taste** — propose an option, don't guess.
- Deleting data, force-push, `--no-verify`, discarding someone else's edits.

Hit a stop — stop and ask, don't "just decide."

## Report (always at the end)

```
AUTOPILOT — <task> — reached: GREEN GATE
- Changed: <files, one per line>
- Verify: lint clean · demo path green
- Pushed: <branch> @ <hash> · PR open
- ★ Needs a human decision: <what to confirm / merge>
```

Hit a hard stop before the gate: `AUTOPILOT — paused: <why> — need your decision on <X>`.

## Task queue

Several tasks — run them one at a time through the full loop, report, next (you can use `/loop`).
Still stop at each one's gate; it doesn't merge or ship in a batch.
