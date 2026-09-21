-- A frame the map's place card matched is written down, on the rows it is about (#198).
--
-- `place_frames` has existed since August with 0 rows. The batch stage that was meant to
-- fill it (/api/enrich/scene-match) works in our uuids; the place card, which is where
-- matching actually happens, calls /api/film-image, which works entirely in Wikidata
-- Q-ids and wrote its answer nowhere but a CDN entry. `works.wikidata_id` and
-- `places.wikidata_id` are both unique, so the two identity spaces join exactly — this
-- migration only adds what a card's answer carries that a batch answer does not.

alter table place_frames
  -- Which stage made the claim. One row is one signal, and the two stages verify
  -- differently: the batch compares candidate frames with the place's reference photo
  -- and re-checks the evidence; the card shortlists against the place photo and then
  -- re-verifies the shortlist blind. Both are vision checks; neither is the other.
  add column if not exists method text not null default 'enrich_scene_match',
  -- The card's matcher is versioned, and bumping the version is how a changed matcher
  -- disowns its old answers. A stored row that ignored it would survive every bump.
  -- Null for the batch stage, which is not versioned.
  add column if not exists matcher_version text,
  -- Street / building / studio ... — the card labels the frame with it, and "studio" is
  -- what stops a description from claiming a specific set.
  add column if not exists location_type text,
  -- The card verifies up to three frames. The first is THE frame for this place, as the
  -- unique index says; the others are the gallery beneath it, verified by the same final
  -- pass, and were shown on a live match. Without them a second visit would show less
  -- than the first.
  add column if not exists also jsonb not null default '[]'::jsonb;

alter table place_frames
  drop constraint if exists place_frames_method_known,
  add constraint place_frames_method_known
    check (method in ('enrich_scene_match', 'film_image')),
  drop constraint if exists place_frames_card_is_versioned,
  add constraint place_frames_card_is_versioned
    check (method <> 'film_image' or matcher_version is not null),
  drop constraint if exists place_frames_also_shape,
  add constraint place_frames_also_shape
    check (jsonb_typeof(also) = 'array' and jsonb_array_length(also) <= 2);

-- A Wikidata pair, resolved to our rows in one round trip: both uuids, whether the graph
-- holds the link between them, and the frame already on record if there is one.
--
-- No row back means one side is not in the graph. Measured on the pairs the map asks
-- about, that is about two in three — the card still matches them live; there is just no
-- row of ours for the answer to live on, and making one is promotion, not caching.
create or replace function frame_for_wikidata_pair(p_work text, p_place text)
returns table (
  work_id uuid,
  place_id uuid,
  place_name text,
  linked boolean,
  file_path text,
  evidence text,
  method text,
  matcher_version text,
  location_type text,
  also jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    w.id,
    p.id,
    p.name,
    exists (
      select 1 from work_place_links l
      where l.work_id = w.id and l.place_id = p.id
    ),
    f.file_path,
    f.evidence,
    f.method,
    f.matcher_version,
    f.location_type,
    f.also
  from works w
  join places p on p.wikidata_id = p_place
  left join place_frames f on f.work_id = w.id and f.place_id = p.id
  where w.wikidata_id = p_work;
$$;
