-- The constraint the schema has claimed since 20260723000000_content_graph.sql:
--
--   unique (work_id, place_id, relation_kind)
--
-- It is not on the live table. Found when the first promotion of verified queue rows tried
-- to upsert on it: "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". Either the migration ran before the table had this shape, or it was
-- dropped by hand; either way the repository and the database disagreed, and the
-- repository was right.
--
-- One triple is duplicated three times, all written in the same transaction on 31.07 with
-- identical timestamps and confidence — the same claim written three times, not three
-- claims. `min()` has no uuid overload, so the row to keep is chosen by `ctid`, which is
-- the physical row and needs no ordering of ids to mean anything.
delete from work_place_links l
 where l.ctid <> (
   select min(keep.ctid) from work_place_links keep
    where keep.work_id = l.work_id
      and keep.place_id = l.place_id
      and keep.relation_kind = l.relation_kind
 );

alter table work_place_links
  add constraint work_place_links_work_place_relation_key
  unique (work_id, place_id, relation_kind);
