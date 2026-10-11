-- The interests deck of the first run (#15): the works a newcomer is most likely to know,
-- among the ones the map can show — and first among the ones it can show HERE.
--
-- Measured on the first version, which ranked the whole world: a reader in London liked
-- Breaking Bad, Game of Thrones, The Godfather and The Lord of the Rings, "Only my films"
-- switched on, and the map of London went empty. So works with a place within
-- p_radius_km of the map's centre come first, by fame; the rest follow, by fame.
--
-- Fame is the panel's "Known for" measure — score/10 × log10(votes), IMDb with at least
-- 1,000 votes. Books carry no IMDb rating, so they are added after, by places (nearby
-- first). There are no songs in `works`, so the deck has none; it does not invent them.
-- The radius is a box, not a circle: it orders a deck, it does not claim a distance.

drop function if exists public.onboarding_deck(integer);

create or replace function public.onboarding_deck(
  p_limit integer default 60,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km double precision default 25
)
returns table (id uuid, title text, year integer, kind text, poster_path text, places integer, nearby integer, fame numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with box as (
    select p_lat as lat, p_lng as lng,
      p_radius_km / 111.0 as dlat,
      p_radius_km / (111.0 * greatest(cos(radians(coalesce(p_lat, 0))), 0.2)) as dlng
  ),
  placed as (
    select l.work_id,
      count(distinct l.place_id)::integer as places,
      count(distinct l.place_id) filter (
        where box.lat is not null
          and pl.lat between box.lat - box.dlat and box.lat + box.dlat
          and pl.lng between box.lng - box.dlng and box.lng + box.dlng
      )::integer as nearby
    from work_place_links l
    join places pl on pl.id = l.place_id
    cross join box
    group by l.work_id
  ),
  ranked as (
    select w.id, w.title, w.year, w.kind, w.poster_path, p.places, p.nearby,
      round((r.score / 10.0) * log(10, r.votes::numeric), 3) as fame
    from works w
    join placed p on p.work_id = w.id
    left join work_ratings r on r.work_id = w.id and r.source = 'imdb' and r.votes >= 1000
    where w.title is not null
  )
  (select * from ranked where kind <> 'book' and fame is not null
    order by (nearby > 0) desc, fame desc, id limit greatest(least(p_limit, 200), 1))
  union all
  (select * from ranked where kind = 'book' order by (nearby > 0) desc, places desc, id limit 20);
$$;

grant execute on function public.onboarding_deck(integer, double precision, double precision, double precision) to anon, authenticated;
