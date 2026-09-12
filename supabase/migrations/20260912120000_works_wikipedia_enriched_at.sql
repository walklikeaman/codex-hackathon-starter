-- When this work was last read out of Wikipedia, whether or not it yielded anything.
--
-- **The enrichment had no notion of progress.** Its query was
-- `select … where wikidata_id is not null limit N` with no ordering and no record of what
-- had already been done, so a second run repeated the first run's works exactly. That was
-- invisible while the pipeline could see 28 works; after the IMDb→Wikidata backfill it can
-- see 5,480, and "run it again for the next batch" silently meant "run it again".
--
-- **Nullable, and stamped even when a work yields nothing.** Most works produce no rows —
-- no production section, or nothing that survives the gates — and those are precisely the
-- ones that must not be retried forever. Recording only successes would retry every barren
-- work on every pass and never reach the rest.
--
-- Reversible and cheap: a null means "never attempted", which is the state every row starts
-- in, so nothing is backfilled and nothing about the existing data changes meaning.
alter table works
  add column if not exists wikipedia_enriched_at timestamptz;

comment on column works.wikipedia_enriched_at is
  'When enrich-from-wikipedia last read this work, successful or not. Null means never '
  'attempted; the script selects on it to continue rather than to repeat.';

-- The query the script actually runs: the unattempted ones, in a stable order.
create index if not exists works_wikipedia_unenriched_idx
  on works (id) where wikidata_id is not null and wikipedia_enriched_at is null;
