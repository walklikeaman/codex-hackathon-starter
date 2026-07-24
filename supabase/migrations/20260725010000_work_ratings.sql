-- Ratings for works, one row per (work, source).
--
-- A separate table rather than columns on `works`: there are several sources, they
-- refresh at different rates, and each needs its own link back to where the number
-- came from. A rating with no visible source is just a number we are asking people to
-- trust — the same reason places carry evidence.
--
-- Sources and how they are obtained:
--   imdb / rotten_tomatoes / metacritic — OMDb API, keyed by imdb_id
--   tmdb                                — TMDB vote_average (always available)
-- Nothing is scraped: OMDb is a licensed aggregator, TMDB is official.

create table if not exists work_ratings (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  source text not null check (source in ('imdb', 'rotten_tomatoes', 'metacritic', 'tmdb')),
  -- Normalised 0..100 so different scales can be compared and sorted.
  score numeric(5, 2) check (score >= 0 and score <= 100),
  -- Exactly how the source states it ("7.8/10", "92%"), so the UI never restates a
  -- rating in a scale its source did not use.
  display text not null,
  votes integer,
  source_url text,
  retrieved_at timestamptz not null default now(),
  unique (work_id, source)
);

create index if not exists work_ratings_work_idx on work_ratings (work_id);

-- The Rotten Tomatoes path (Wikidata P1258, e.g. "m/skyfall") — the only way to build
-- a real RT link, since OMDb returns the score but not the URL.
alter table works add column if not exists rt_path text;

alter table work_ratings enable row level security;

drop policy if exists "work_ratings are public read" on work_ratings;
create policy "work_ratings are public read" on work_ratings for select using (true);

-- map_works carries the ratings inline so the picker and the card need one call.
-- Adding columns changes the return type, so the function must be DROPPED first —
-- `create or replace` refuses, exactly as it did for the poster column.
drop function if exists public.map_works(text[], int);

create function map_works(p_kinds text[] default null, p_limit int default 200)
returns table (
  work_id uuid, title text, kind text, place_count integer,
  poster_path text, imdb_id text, rt_path text, ratings jsonb
)
language sql stable as $$
  select w.id, w.title, w.kind, count(distinct l.place_id)::int, w.poster_path,
         w.imdb_id, w.rt_path,
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'source', r.source, 'score', r.score,
                     'display', r.display, 'url', r.source_url)
                   order by case r.source
                     when 'imdb' then 1 when 'rotten_tomatoes' then 2
                     when 'metacritic' then 3 else 4 end)
            from work_ratings r where r.work_id = w.id),
           '[]'::jsonb)
  from works w
  join work_place_links l on l.work_id = w.id
  join places p on p.id = l.place_id
  where place_is_mappable(p.lat, p.place_class, p.confidence, p.id)
    and (p_kinds is null or w.kind = any(p_kinds))
  group by w.id, w.title, w.kind, w.poster_path, w.imdb_id, w.rt_path
  order by count(distinct l.place_id) desc, w.title
  limit p_limit
$$;
alter table works add column if not exists mc_path text;
