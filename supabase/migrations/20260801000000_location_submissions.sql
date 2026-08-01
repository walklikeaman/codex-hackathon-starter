-- Candidate places from prose, waiting to be believed (#47, #48).
--
-- #48 built the review gate — pending → verified → rejected — and noted it had nothing
-- to gate, because AI-discovered locations never persisted anywhere. This is the
-- missing half: the queue they arrive in.
--
-- A submission is NOT a place. It becomes one only if it clears review, so nothing
-- here is reachable from the map. That separation is the point: the `places` table
-- should hold things we believe, not things we are considering.

create table if not exists location_submissions (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  place_name text not null,
  area_hint text,
  source_sentence text not null,
  source_title text not null,
  source_revid integer not null,
  source_url text not null,
  source_license text not null default 'CC BY-SA 4.0',
  lat double precision,
  lng double precision,
  geocode_source text,
  geocode_source_id text,
  geocode_license text,
  geocode_reason text,
  status place_review_status not null default 'pending',
  status_reason text,
  reviewed_at timestamptz,
  place_id uuid references places(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint location_submissions_has_source check (length(btrim(source_sentence)) >= 10),
  constraint location_submissions_real_revid check (source_revid > 0),
  constraint location_submissions_geocode_provenance check (
    lat is null or (lng is not null and geocode_source is not null and geocode_license is not null)
  )
);

create unique index if not exists location_submissions_unique_idx
  on location_submissions (work_id, lower(btrim(place_name)));

create index if not exists location_submissions_pending_idx
  on location_submissions (status) where status = 'pending';

alter table location_submissions enable row level security;

drop policy if exists "submissions are readable by everyone" on location_submissions;
create policy "submissions are readable by everyone"
  on location_submissions for select using (true);
