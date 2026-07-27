-- Which of a film's gallery images are actually frames FROM the film (#107).
--
-- TMDB mixes production stills with promotional key art under one "backdrops" list and
-- nothing in the metadata separates them, so the picture has to be looked at. That
-- costs a model call, and the answer for a given image file never changes — so it is
-- paid for exactly once and stored here.
--
-- Rejected images are stored too, and that is the whole point of the table: without a
-- negative row we would re-ask about the same poster on every visit.

create table if not exists work_images (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  -- TMDB's own path, e.g. "/hoQhlAskVNgLQhArnH7reWP4pUp.jpg". Stable and unique per
  -- image, which makes it the natural key alongside the work.
  file_path text not null,
  -- The verdict: true = a photographic frame from the film, false = poster, title card,
  -- logo art or a posed press shot.
  is_frame boolean not null,
  width integer,
  height integer,
  classified_at timestamptz not null default now(),
  constraint work_images_path_shape check (file_path ~ '^/[A-Za-z0-9._-]+$')
);

-- One verdict per image per work, so re-running the classifier updates rather than
-- duplicates. A plain unique index (not partial) so it can be an upsert target — a
-- partial one cannot, which cost us a migration on the places table already.
create unique index if not exists work_images_unique_idx
  on work_images (work_id, file_path);

-- The gallery reads "frames for this work", so the filter is part of the index.
create index if not exists work_images_frames_idx
  on work_images (work_id) where is_frame;

alter table work_images enable row level security;

-- Gallery images are public knowledge about public films; only the service role
-- writes them, since only the enrichment job may spend model calls.
drop policy if exists "work_images are readable by everyone" on work_images;
create policy "work_images are readable by everyone"
  on work_images for select using (true);
