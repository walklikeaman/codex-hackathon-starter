---
description: Demo-path-green loop — get the ONE flow a judge will watch working end to end, then stop. The hackathon judging criterion, as a loop.
---

Start the 'Demo path green' loop. Goal: the one locked demo flow (see the
**Project** block in AGENTS.md) works end to end, verified by actually running it.
Max iterations: 10.

Step 1: Restate the demo path as concrete steps a judge performs
(e.g. "open /, type a URL, click Generate, see the label render, click Print").
If it isn't written in AGENTS.md, write it there first.

Step 2: Walk the path for real — not "it should work". Load the page, hit the
endpoint, drive it with the Playwright MCP if wired. Capture where it breaks:
the FIRST broken step.

Step 3: Fix the root cause of that first break with a minimal change. Prefer real
data flowing through over a hardcoded mock — but a hardcoded value that makes the
demo land beats a "correct" pipeline that doesn't render in time. Note any such
shortcut in `.loops/guardrails.md` so nobody mistakes it for finished.

Step 4: Re-run the whole path from step 1. Move on only when the previous break
is green. Continue only if the path still breaks somewhere.

Step 5: When the full path is green, STOP. Don't add features inside this loop —
protect the win. New ideas go in AGENTS.md's out-of-scope list. Immediately record
a 60-90s screen capture of the green path (`Cmd-Shift-5` on macOS) — that clip is
your backup demo if Wi-Fi or the laptop fails on stage.

Guardrails:

- Verify by running, never by reading the code and assuming.
- Don't widen scope mid-loop. One flow, green, on stage.
- No production deploys / no sending anything as part of "the demo" without a human OK.
