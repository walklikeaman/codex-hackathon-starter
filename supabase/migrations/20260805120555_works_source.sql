-- Where a work came from. The catalogue is about to stop being hand-curated.
--
-- Until now `works` held 15 rows, every one of them entered deliberately and
-- carrying a wikidata_id. Importing 6,029 films from a scrape changes what the
-- table IS, and without this column nobody could afterwards tell a curated row
-- from a scraped one -- which is the exact failure 20260805010000 was written
-- against ("with no recorded source there is no way to tell a right row from a
-- wrong one").
--
-- Nullable, and left null on the existing rows rather than backfilled with a
-- guess. Null here means "entered before this column existed", which is true;
-- writing 'manual' on all fifteen would be a claim nobody checked.
alter table works
  add column if not exists source text;

comment on column works.source is
  'Where this work came from, e.g. ''moviemaps''. Null = predates the column. A scraped work is a catalogue entry, not a verified one.';

-- The question this column exists to answer is "which works did we not curate",
-- so the index is the partial one that answers it.
create index if not exists works_source_idx on works (source) where source is not null;
