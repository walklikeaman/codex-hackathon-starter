-- Captured from production 2026-08-08. This migration was applied through the
-- Supabase MCP and never written to a file; the repo therefore did not describe the
-- database. Body below is verbatim from supabase_migrations.schema_migrations.

-- A frame from a film, matched to the real place it was shot at (#57, #107 tier A).
--
-- Separate from work_images on purpose. That table answers "is this a frame?", a fact
-- about the picture. This one asserts "this scene was shot HERE", a claim about the
-- world — the product's central promise, and the thing it must never invent.
--
-- `evidence` is not decoration: a row may only exist if the model named the visible
-- features that prove it, so every match can be argued with rather than trusted.

create table if not exists place_frames (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  place_id uuid not null references places(id) on delete cascade,
  file_path text not null,
  evidence text not null,
  matched_at timestamptz not null default now(),
  constraint place_frames_path_shape check (file_path ~ '^/[A-Za-z0-9._-]+$'),
  -- No evidence, no claim.
  constraint place_frames_has_evidence check (length(btrim(evidence)) >= 10)
);

-- One frame per place per work: a place is one spot, and several "the" frames for it
-- is a way of not having decided.
create unique index if not exists place_frames_unique_idx
  on place_frames (work_id, place_id);

create index if not exists place_frames_place_idx on place_frames (place_id);

alter table place_frames enable row level security;

drop policy if exists "place_frames are readable by everyone" on place_frames;
create policy "place_frames are readable by everyone"
  on place_frames for select using (true);
