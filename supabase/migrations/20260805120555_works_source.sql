-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.

-- Where a work came from. The catalogue is about to stop being hand-curated.
--
-- Until now `works` held 15 rows, every one entered deliberately and carrying a
-- wikidata_id. Importing thousands of films from a scrape changes what the table
-- IS, and without this column nobody could afterwards tell a curated row from a
-- scraped one -- the exact failure 20260805010000 was written against.
--
-- Nullable, and left null on the existing rows rather than backfilled with a
-- guess. Null means "entered before this column existed", which is true.
alter table works
  add column if not exists source text;

comment on column works.source is
  'Where this work came from, e.g. ''moviemaps''. Null = predates the column. A scraped work is a catalogue entry, not a verified one.';

create index if not exists works_source_idx on works (source) where source is not null;
