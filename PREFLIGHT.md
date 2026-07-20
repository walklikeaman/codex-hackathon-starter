# Preflight — install this BEFORE the hackathon

OpenAI Build Week Hackathon · Tel Aviv · Jul 21, 17:00 → midnight · build with Codex.

Do this the **day before** — on-site Wi-Fi + npm are slow, and you don't want to
burn build time (or a live demo) on setup or a surprise OAuth. ~25 minutes.

## Everyone (5 things)

1. **Node 22+** — `node --version`. Missing? https://nodejs.org (LTS) or `nvm install 22`.
2. **OpenAI account** — the one you'll use for Codex. (You get $150 credits at the event.)
3. **Supabase account** (app.supabase.com, free) — for DB/auth. The tooling signs
   in via your browser; no token to prepare.
4. **Vercel account** (vercel.com, free) — for one-click preview deploys.
5. **GitHub account** — so the team shares one repo.

## One person per team: stand up the starter (day before)

```bash
git clone https://github.com/walklikeaman/codex-hackathon-starter.git && cd codex-hackathon-starter

./setup.sh          # installs Codex + CodeGraph + Vercel, wires Supabase + Vercel MCP
./scaffold.sh       # runnable Next.js app in ./app  (pre-caches packages now, not on stage)
codex               # sign in
vercel login
```

**Pre-warm the OAuth + MCPs at home** (so nothing pops a browser mid-demo):
open Codex once and ask it to "list Supabase projects" and "list Vercel
deployments" — that triggers each MCP's one-time in-browser sign-in now.

Verify: `codex mcp list` shows `codegraph`, `supabase`, `vercel`. Details and
troubleshooting in **INSTALL.md**.

## What the starter gives the team

- **Codex, pre-briefed** — reads `AGENTS.md` and works our way (autopilot,
  scope-guard, clean commits) without being re-taught each session.
- **Supabase + Vercel** — backend and deploy in minutes, driven from the agent.
- **A runnable app from minute one** — `scaffold.sh` means no `create-next-app`
  wait at the venue.
- **`/ship`, `/loop-demo`** — persist working code; drive the demo flow to green.
- **CodeGraph** — a local code index that pays off as the build grows.

## On the day

- First move: fill the **Project** block in `AGENTS.md` (idea, stack, the ONE
  demo path, what's out of scope). Align the whole team on that one flow.
- Deploy to a Vercel preview URL early — always have a live link to show.
- The moment the demo path works, record a 60-90s screen capture — your backup
  if anything fails on stage.
- One flow that works end to end beats five that half-work. Judges score the demo.

Questions on setup → ping in the group.
