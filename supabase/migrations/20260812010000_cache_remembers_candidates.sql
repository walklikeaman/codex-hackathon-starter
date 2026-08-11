-- A cached refusal has to remember what it refused between (#149).
--
-- `geocode_cache` stores a null coordinate for a name the gazetteer would not resolve,
-- and until now that was the whole of what it stored. That is enough while a refusal
-- means "nothing to be done with this name", and it stopped meaning that the moment the
-- anchor test landed: `london` is refused as an ambiguous homonym and its eleven
-- candidates are still a perfectly good thing to sanity-check a London street against.
--
-- So a cache hit on `london` would have handed back a refusal with no candidates and
-- **silently defeated the new check** — the second run of a two-run job would quietly
-- accept fewer rows than the first, for no reason anybody could see.
--
-- jsonb rather than a second table: the list is small, it is written and read whole, and
-- nothing ever queries into it.

alter table geocode_cache
  add column if not exists candidates jsonb;

comment on column geocode_cache.candidates is
  'What the gazetteer offered, including when it refused to choose. A refusal with candidates can still anchor a containment check; a refusal without them cannot, so this is not decoration.';

-- A refusal that remembers nothing is indistinguishable from one that had nothing to
-- remember, and the two behave differently. Recorded rather than enforced: rows written
-- before this column existed are honestly unknown, and a NOT NULL would make them a lie.
create index if not exists geocode_cache_anchorable_idx
  on geocode_cache (query_norm)
  where lat is null and candidates is not null;
