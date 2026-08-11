-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.

-- A fifth kind of submission: movie-locations.com.
--
-- Alone in its own migration, as with moviemaps and reelstreets: Postgres
-- refuses to USE a new enum value in the transaction that created it.
alter type submission_source_kind add value if not exists 'movielocations';
