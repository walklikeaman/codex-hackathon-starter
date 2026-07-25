-- Type-ahead search over the graph, IMDb-style: a couple of characters should already
-- put the obvious answer first.
--
-- Ranking matters more than matching. Trigram similarity ALONE ranks badly for short
-- input — typing "sky" scores "Sherlock" and "Skyfall" almost alike, because
-- similarity is dominated by length. So exact and prefix hits are scored explicitly
-- ABOVE fuzzy ones, and similarity only breaks the remaining ties:
--
--   4.0  the normalised title is exactly what was typed
--   3.0  the title starts with it               ("sky" → Skyfall)
--   2.0  a word inside the title starts with it  ("pot" → Harry Potter…)
--   1.x  fuzzy, ranked by trigram similarity     (typos)
--
-- p_query arrives ALREADY normalised by app/lib/content-graph.mjs normalizeWorkTitle —
-- the same function that produced title_norm on import. Normalising in one place is
-- what makes "amelie" match "Amélie"; doing it twice, in two languages, is how the two
-- sides drift apart.
--
-- No LIKE pattern is built from user input: starts_with() and strpos() take the query
-- as a plain value, so a title containing % or _ cannot change what matches.

create or replace function search_works(p_query text, p_limit int default 8)
returns table (
  work_id uuid,
  title text,
  kind text,
  year integer,
  poster_path text,
  place_count integer,
  rank real
)
language sql stable
as $$
  with scored as (
    select w.id, w.title, w.kind, w.year, w.poster_path,
      case
        when w.title_norm = p_query then 4.0
        when starts_with(w.title_norm, p_query) then 3.0
        when strpos(w.title_norm, ' ' || p_query) > 0 then 2.0
        else 1.0 + similarity(w.title_norm, p_query)
      end::real as rank
    from works w
    where p_query <> ''
      and (
        starts_with(w.title_norm, p_query)
        or strpos(w.title_norm, ' ' || p_query) > 0
        or similarity(w.title_norm, p_query) > 0.2
      )
  )
  select s.id, s.title, s.kind, s.year, s.poster_path,
         (select count(distinct l.place_id)::int
          from work_place_links l join places p on p.id = l.place_id
          where l.work_id = s.id
            and place_is_mappable(p.lat, p.place_class, p.confidence, p.id)),
         s.rank
  from scored s
  -- Ties break toward the work we can actually show places for.
  order by s.rank desc,
           (select count(*) from work_place_links l where l.work_id = s.id) desc,
           length(s.title), s.title
  limit greatest(1, least(p_limit, 25))
$$;
