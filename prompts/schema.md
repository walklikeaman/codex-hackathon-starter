---
description: Design the MINIMAL Supabase schema for the demo path and apply it — only after the idea is locked. Owned by one person (backend).
---

# /schema — a minimal database for the demo, nothing more

Run ONLY once the idea and demo path are locked (the "Project" block in AGENTS.md is filled in).
Before that, we don't create tables — a schema guessed at for an unknown idea is wasted time.

The schema is owned by **one person** (backend); everyone else reads the database via shared keys. That
way there are no conflicting migrations in the middle of the hackathon.

## Steps

1. **Take the demo path** and write out what data it actually touches — not "for the future,"
   but exactly what the demo shows. Usually that's 1–3 tables.
2. **Design the minimum:** tables, fields, relations. No "just-in-case" tables.
   Explicitly name what we're deliberately NOT doing right now.
3. **Apply** it via Supabase MCP (`apply_migration` / `execute_sql`) to the shared project.
   One migration with a clear name.
4. **RLS.** By default Supabase blocks anon access. For the demo, enable RLS and add
   policies scoped exactly to the demo path (e.g. public read + insert for anon, if that's
   the intent). Don't leave a table open wider than the demo needs.
5. **Verify:** do one write and one read with the same anon key the app uses
   (`app`/root reads `NEXT_PUBLIC_SUPABASE_*`). It passed — the schema is ready.
6. **Lock the data contract** in `TASKS.md` (tables + fields + response shape) so the
   frontend can proceed in parallel.

## Rules

- Minimum for the demo; expand only when the demo path requires it.
- Change the schema on the fly — warn the team (data contract in `TASKS.md`).
- No secrets in the client: private operations go server-side (service_role in the server's
  env, not in the browser), not in `NEXT_PUBLIC_*`.
