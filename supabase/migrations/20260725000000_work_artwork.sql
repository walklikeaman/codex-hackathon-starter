-- Cover art for works. Posters come from TMDB, which is the licensed, official API —
-- deliberately NOT scraped from IMDb, whose terms forbid extraction and whose markup
-- would break the moment it changes.
--
-- Only the PATH is stored, never a full URL: image.tmdb.org serves the file publicly
-- with no key, and keeping the path lets the client pick a size (w185 for a list,
-- w500 for a card) without a round-trip or a second stored column.

alter table works add column if not exists poster_path text;
alter table works add column if not exists backdrop_path text;
alter table works add column if not exists artwork_updated_at timestamptz;

-- Only works that still need artwork, so the enrichment pass can find its own backlog
-- cheaply as the library grows.
create index if not exists works_missing_poster_idx on works (id)
  where poster_path is null;

-- map_works gains the poster path so one call fills the picker with cover art.
-- Adding a column to `returns table` CHANGES THE RETURN TYPE, which `create or replace`
-- refuses ("cannot change return type of existing function") — it must be dropped
-- first. Same family of trap as the accidental overloads in 20260724020000.
drop function if exists public.map_works(text[], int);

create function map_works(p_kinds text[] default null, p_limit int default 200)
returns table (work_id uuid, title text, kind text, place_count integer, poster_path text)
language sql stable as $$
  select w.id, w.title, w.kind, count(distinct l.place_id)::int as place_count, w.poster_path
  from works w
  join work_place_links l on l.work_id = w.id
  join places p on p.id = l.place_id
  where place_is_mappable(p.lat, p.place_class, p.confidence, p.id)
    and (p_kinds is null or w.kind = any(p_kinds))
  group by w.id, w.title, w.kind, w.poster_path
  order by count(distinct l.place_id) desc, w.title
  limit p_limit
$$;
