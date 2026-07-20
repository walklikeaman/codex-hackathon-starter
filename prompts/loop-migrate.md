---
description: Database migration loop — run pending Supabase migrations, fix schema errors, verify status, repeat until all migrations are applied cleanly. Run after writing new migration files.
---

Start the 'Migration Until Applied' loop. Goal: all pending migrations are applied with no errors and status is clean. Max iterations: 6. Between iterations run: `supabase db push --dry-run 2>&1 | tail -20; echo "---"; supabase migration list 2>&1 | tail -10`. Exit when: no pending migrations remain and status shows all applied.

Step 1: Run `supabase migration list` to see current state. Identify pending migrations.

Step 2: Run `supabase db push` (or `supabase db push --dry-run` first to preview). If it fails, read the error carefully — fix the SQL schema issue in the migration file, regenerate types if needed.

Step 3: After a successful push, verify: `supabase migration list` shows all applied, no pending. If the migration adds new tables/columns, verify they appear in `supabase db diff`.

Step 4: Self-pace. Continue only if migrations remain or errors persist.

**Guardrail rules:**
- Never modify a migration file that has already been applied to production — create a new one instead.
- Do not skip the dry-run step for destructive migrations (DROP, ALTER with data change).
- Never delete migration history files.
- If a migration would destroy data, stop and ask the operator before proceeding.
