-- Of several works that match the typed words equally well, the famous one first.
--
-- "Star Wars" put Attack of the Clones first and cut The Empire Strikes Back off the list
-- entirely: every "Star Wars: …" title ranks the same (the typed words begin each of them),
-- and the tie broke toward whichever work we hold the most places for — Episode II had five.
-- A juror typing "Star Wars" means the 1977 film, and the list is eight rows long, so the
-- ninth-placed Empire was simply not there.
--
-- IMDb's vote count is the answer the catalogue already holds: 5,495 of 7,063 works carry it,
-- and it orders the saga the way anyone would — A New Hope 1.59M, Empire 1.52M, Return of
-- the Jedi 1.22M. It is the same principle the live Wikidata search follows with sitelinks:
-- of several things with one name, the famous one.
--
-- Measured before changing anything, on 40 queries (the 24 of the juror test and the
-- franchises that share a prefix): 5 first answers change. Star Wars -> A New Hope, Pirates
-- of the Caribbean -> The Curse of the Black Pearl, Batman -> the 1989 film, Alien -> an
-- Alien film rather than "Aliens in America", and Harry Potter -> Deathly Hallows Part 2,
-- with Philosopher's Stone second. None of the 24 juror titles moves.
--
-- Fame breaks ties only WITHIN a match band, never across one: an exact title still beats a
-- famous prefix. Places stay the next tiebreak, and a work with no IMDb row sorts after one
-- that has it rather than being guessed at.
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
set search_path = public, extensions, pg_catalog
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
  order by s.rank desc,
           (select r.votes from work_ratings r where r.work_id = s.id and r.source = 'imdb') desc nulls last,
           (select count(*) from work_place_links l where l.work_id = s.id) desc,
           length(s.title), s.title
  limit greatest(1, least(p_limit, 25))
$$;
