-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.

-- A fourth kind of submission: reelstreets.com.
--
-- Alone in its own migration for the same reason as moviemaps_source_kind:
-- Postgres refuses to USE a new enum value in the transaction that created it,
-- so the evidence check that names it has to be a separate transaction.
alter type submission_source_kind add value if not exists 'reelstreets';
