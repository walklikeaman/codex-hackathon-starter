-- The A-Z half of the directory (#158): 6,392 works, one page of URLs per letter.
--
-- Filed by the first character of `title_norm` AFTER a leading article is removed, and
-- that removal is the whole design of this function. Our sources disagree about articles:
-- movie-locations ships "Caper of the Golden Bulls, The" and TMDB ships "The Dark Knight".
-- Filing on the raw column put 1,427 of 6,392 works — 22% of the catalogue — under T,
-- measured before this rule existed. Stripping a LEADING "the/a/an" fixes exactly the
-- titles that carry one and leaves the comma-inverted ones alone, because theirs is
-- already at the end. One rule, both conventions, and the same rule in the client's
-- letterBucket() so a work is never filed under a letter its own page does not list.
--
-- The letter test is `strpos` over an explicit alphabet rather than `~ '^[a-z]'` or a
-- BETWEEN. A character range in a regular expression or a comparison is resolved against
-- the database collation, and this database is not in the C locale: under en_US.UTF-8
-- 'Á' sorts between 'a' and 'b', so a range test would file an accented title under a
-- letter and the enumerated test files it under '#', which is where the client expects it.

-- The one place the article rule lives. Immutable, so it can be indexed later if the
-- catalogue ever outgrows a sequential scan.
create or replace function directory_sort_key(p_title_norm text)
returns text
language sql immutable
set search_path = pg_catalog
as $$
  select case
    when p_title_norm like 'the %' then substr(p_title_norm, 5)
    when p_title_norm like 'an %'  then substr(p_title_norm, 4)
    when p_title_norm like 'a %'   then substr(p_title_norm, 3)
    else p_title_norm
  end
$$;

comment on function directory_sort_key(text) is
  'A title stripped of its leading article, so "The Dark Knight" files under D and "Caper of the Golden Bulls, The" still files under C.';

create or replace function catalogue_letter(
  p_letter text,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  work_id uuid,
  title text,
  title_norm text,
  year integer,
  kind text,
  place_count integer,
  total_works integer
)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  select
    c.id,
    c.title,
    c.title_norm,
    c.year,
    c.kind::text,
    c.place_count,
    count(*) over ()::int
  from catalogue_index c
  where case
          when p_letter is not null and length(p_letter) = 1
               and strpos('abcdefghijklmnopqrstuvwxyz', lower(p_letter)) > 0
            then left(directory_sort_key(c.title_norm), 1) = lower(p_letter)
          -- Anything not opening with a Latin letter: "1917", "28 Weeks Later", and any
          -- title in another alphabet. A real bucket with real works in it.
          else strpos('abcdefghijklmnopqrstuvwxyz', left(directory_sort_key(c.title_norm), 1)) = 0
        end
  order by directory_sort_key(c.title_norm) asc, c.year asc nulls last
  limit greatest(1, least(p_limit, 500))
  offset greatest(0, p_offset)
$$;

comment on function catalogue_letter(text, integer, integer) is
  'One page of the A-Z directory. Filed by the first character of title_norm because that is the one column both the database order and the client bucket agree on.';

-- How many works and places sit under each letter, so the index can show the shape of the
-- catalogue instead of 27 identical links. One pass over 6,392 rows.
--
-- `points` is here rather than left to the caller because the index's headline sentence
-- names both numbers, and summing the CITY points instead would have said "6,392 films
-- with 20,296 places" — a global work count beside a count of only the part of the map
-- that happens to be near a listed city. The two halves of a sentence have to be measured
-- over the same set.
create or replace function catalogue_letter_totals()
returns table (letter text, works integer, points integer)
language sql stable
set search_path = public, extensions, pg_catalog
as $$
  select
    case when strpos('abcdefghijklmnopqrstuvwxyz', left(directory_sort_key(c.title_norm), 1)) > 0
         then left(directory_sort_key(c.title_norm), 1) else '#' end,
    count(*)::int,
    sum(c.place_count)::int
  from catalogue_index c
  group by 1
$$;

comment on function catalogue_letter_totals() is
  'Works and located places per directory letter. Lets the index state its own shape, and its headline, over one set of rows.';
