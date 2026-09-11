-- How a submitted place is tied to its work.
--
-- **The graph has been able to say this since July and the review queue could not.**
-- `relation_kind` on `work_place_links` has held 'filming_location', 'narrative_location',
-- 'author_place', 'artist_place' and 'studio_of' since the content graph was created, but
-- every row arriving through `location_submissions` was implicitly a filming location —
-- the column simply did not exist, so the distinction died at the queue.
--
-- That mattered the moment the extractors were widened. A work is not only a film and a
-- place is not only where a camera stood: if Rowling wrote in a particular Edinburgh café
-- and took character names off the stones in Greyfriars Kirkyard, those are real places a
-- reader can walk to. [[three-axes]] already called this "the common shape of the best
-- material", measured against operator itineraries where we cover 8 of the 47 Edinburgh
-- Harry Potter stops.
--
-- **The default is what every existing row already meant.** Everything queued before this
-- migration came from a filming-locations parser or from a prompt that asked for filming
-- locations only, so 'filming_location' is not a guess about those rows — it is what they
-- are. Nothing is backfilled because nothing needs correcting.
alter table location_submissions
  add column if not exists relation_kind relation_kind not null default 'filming_location';

comment on column location_submissions.relation_kind is
  'How the place is tied to the work: filming_location, author_place, and so on. Set when '
  'the claim is made, so a reviewer never has to re-read the sentence to classify it.';

-- The queue is read by kind — "show me the author places waiting" is a different review
-- session from "show me the filming locations", and they are worked through differently.
create index if not exists location_submissions_relation_idx
  on location_submissions (relation_kind, status);
