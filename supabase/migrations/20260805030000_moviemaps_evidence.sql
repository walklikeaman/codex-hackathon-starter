-- What a moviemaps.org submission owes, and the hole that let it owe nothing.
--
-- The evidence rule from 20260803000000 is a CASE over source_kind with no ELSE. A CASE
-- that matches nothing returns NULL, and a CHECK constraint treats NULL as PASSED. So
-- the moment 'moviemaps' became a legal enum value, every moviemaps row satisfied the
-- evidence rule by not being mentioned in it — silently, which is the worst way for a
-- rule about provenance to fail. `else false` closes that: a kind nobody has thought
-- about cannot be written at all.
--
-- What this kind owes: its location id at moviemaps.org. Same demand as a permit
-- record, for the same reason — a row must be traceable to the record it came from
-- rather than to a site that mentions it.
--
-- What it deliberately does NOT owe: a scene description. MovieMaps often has one
-- ("Cameron and Michael head to a biker bar") and often does not, and requiring it
-- would push the ingest into writing a sentence to satisfy the schema. An invented
-- sentence is worse than an absent one.

alter table location_submissions
  drop constraint if exists location_submissions_evidence_for_kind;

alter table location_submissions
  add constraint location_submissions_evidence_for_kind check (
    case source_kind
      when 'wikipedia' then
        source_sentence is not null
        and length(btrim(source_sentence)) >= 10
        and source_revid is not null
        and source_revid > 0
      when 'permit_record' then
        source_record_id is not null
        and length(btrim(source_record_id)) > 0
      when 'moviemaps' then
        source_record_id is not null
        and length(btrim(source_record_id)) > 0
      else false
    end
  );

-- Frames, for the REVIEWER — not for the product.
--
-- MovieMaps shows screenshots from the film at each location, and those are the best
-- evidence a submission of this kind can carry: a reviewer can look at the frame and
-- the place and decide. So the URLs ride along.
--
-- They are stored as links, never as bytes, and they are not `work_images`. That table
-- is keyed on a TMDB file_path and holds the gallery the product renders; the poster
-- pipeline in app/lib/work-artwork.mjs states the policy plainly — artwork comes from
-- the licensed API, and is not scraped, because the art is studio-licensed. A frame on
-- moviemaps.org is the same studio still with a copyright line on its image page
-- ("Copyright Touchstone Pictures") and no licence granted to us. Copying it into the
-- gallery would launder a scrape into product content.
--
-- Shape: [{"page": "https://moviemaps.org/images/fji", "thumb": "…320.jpg", "full": "…940.jpg"}]
alter table location_submissions
  add column if not exists source_media jsonb;

comment on column location_submissions.source_media is
  'Evidence images for review, as links to the source. Not licensed for display in the product.';
