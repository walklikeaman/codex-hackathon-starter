# How we work as a team

Pre-prep: the collaboration rules so that four of us plus the agents don't bump into each other.
Roles and people are handed out at the kickoff — this is just the scheme and the rules.

## The main rule: separate branches → one person merges into main

- Everyone works in **their own branch** (`feature/<short>`), not in `main`. We don't push straight to `main` — otherwise you overwrite someone else's changes and hit conflicts.
- Push your branch → open a Pull Request → the **integrator** merges it into `main`.
- Only the **integrator** pushes straight into `main`. Everyone else goes through a PR.
- The shared Vercel builds a preview for every branch, so you can show a piece even before the merge.

## Roles (divide up at the kickoff, ~1 person each)

Until they're assigned — write yourself into `TASKS.md`. Roles aren't rigid: once you've closed your piece, help the next one.

- **Integrator / main** — keeps `main` green, merges PRs, owns the scope in `AGENTS.md`, resolves conflicts.
- **Backend** — Supabase: schema, auth, API. Runs `./setup.sh --infra`.
- **Frontend** — screens and flows.
- **Demo and deploy** — Vercel, runs the whole demo path, records the demo, pitch.

## Kickoff (first 30–45 minutes, all together)

1. Fill out the "Project" block in `AGENTS.md`: idea, stack, one demo path, what's out of scope.
2. Agree on the **data contract** (tables, fields, the shape of the API response) — this unblocks parallel work.
3. Slice the demo path into 4–6 vertical slices, write them into `TASKS.md`, divide them among yourselves.
4. The owner spins up the shared Supabase + Vercel and sends the keys (see `INSTALL.md`).

## Rhythm

- `git pull` before you start working.
- `/ship` often, in small commits.
- **Integration every 60–90 minutes**: everyone pushes, the integrator merges into `main`, deploys a preview, and we check the demo path is still alive.

## Rules

1. Separate branches, only the integrator merges into `main`.
2. Scope is locked in `AGENTS.md`, the demo path is sacred. A new idea → into "out of scope", not into the code.
3. The data contract comes before splitting backend and frontend.
4. Don't have two agents editing one file at once — split by folders.
5. Continuous preview deploy — there's always a live link.
6. Decisions and agreements — in `wiki/` or pinned in the chat, so all agents and people can see them.

## Everyone works in their own Codex

Your own Codex on your own branch — the agents don't conflict as long as the people are on different branches and files.
The integrator merges the PRs (possibly via `/loop-pr-review`). Running several agents at once for one person
during a hackathon isn't something I'd recommend — one focused agent per branch is easier.
