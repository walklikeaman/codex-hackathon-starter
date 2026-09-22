-- A plaque's link says what the plaque says (#queue-review, follow-up to 20260922020000).
--
-- Every promoted row was written as a `filming_location`, the 52 Open Plaques links among
-- them. Their inscriptions — now printed on the cards verbatim — say something else as
-- often as not: "The novel Crime and Punishment was written here", "J. R. R. Tolkien
-- author of The Lord of the Rings lived here", "These steps were the scene of the murder
-- of Nancy". The sentence on the card became true on 22.09; the kind beneath it, which
-- decides the block a fact is shown in and whether a route may stop there, did not.
--
-- Each of the 52 was read by hand; the decisions are by link id, not by a rule, because
-- 52 is few enough to read and a rule would have to be right about every one of them.
--
--   21 stay filming_location — "was filmed here", "filming location", "location site of scenes".
--   14 -> author_place   the work was written, or its maker lived or was born, here.
--    3 -> artist_place   an actor or crew member: Roger Moore, Barbara Windsor, a cinematographer.
--    2 -> narrative_location   Paddington arriving at the station; Nancy's murder on the steps.
--    4 -> inspiration_for      a pub that became "The Three Cripples"; the band behind
--                              Brassed Off; a crony who became Dick Baker; the von Trapps.
--    1 -> replica        a house modelled on Tara from Gone with the Wind.
--    2 -> studio_of      Gainsborough Film Studios, for The Wicked Lady.
--
-- Not changed here, and left for the owner: 5 links whose WORK is wrong, not their kind —
-- a plaque about The Italian Job on "The Italian" (2010); Basil Rathbone on a 1964
-- "Sherlock Holmes"; Diana Rigg's 1965 series on the 1998 "The Avengers"; Porter's 1903
-- film on a 1978 "The Great Train Robbery"; a 1921 Fairbanks screening on a 1993 "The
-- Three Musketeers". Only deleting them fixes them.
--
-- Reversible: update work_place_links set relation_kind = 'filming_location' where id in
-- (the ids below).

with decided(id, kind) as (values
  ('d64e6494-fb7a-467e-9dd0-76699d4426f8'::uuid, 'author_place'),       -- Crime and Punishment: "was written here"
  ('aeff2b7f-82c5-4de2-b848-6885dd1d25b8'::uuid, 'author_place'),       -- Dial M For Murder: Knott wrote it here
  ('b54cc254-fd15-41c4-962b-07ffda40cc95'::uuid, 'author_place'),       -- Finnegans Wake: Joyce wrote part here
  ('c5c177b0-7651-4ac6-b93e-6e4274f4b22d'::uuid, 'author_place'),       -- Riders of the Purple Sage: written here
  ('37ee2764-517e-421f-9a99-317670b35aa7'::uuid, 'author_place'),       -- The King of the Golden River: partly written here
  ('b05580e6-aa99-4ffb-a058-96fa078085d7'::uuid, 'author_place'),       -- You Only Live Twice: Fleming wrote the novel here
  ('3c4face1-99a4-4dda-9c58-c3409b473b74'::uuid, 'author_place'),       -- The Lord of the Rings: Tolkien convalesced here
  ('1792eb40-d5f6-4f5c-8836-211b5fa1a442'::uuid, 'author_place'),       -- The Lord of the Rings: Tolkien lived here
  ('5ca59846-1c49-4438-b503-d9cc9fa12266'::uuid, 'author_place'),       -- The Lord of the Rings: Tolkien's birthplace
  ('b0257eac-9719-4d06-8646-818ddb950cc4'::uuid, 'author_place'),       -- Black Narcissus: Rumer Godden
  ('33545c1d-f562-482c-ab98-8d24831f3b0a'::uuid, 'author_place'),       -- Billy Liar: Keith Waterhouse's creations
  ('dd94d582-308e-4449-8f59-8529df7d8e01'::uuid, 'author_place'),       -- Hot Fuzz: Edgar Wright's school
  ('7137a122-c7cb-4a35-a027-c6c7f1568ac5'::uuid, 'author_place'),       -- The Gold Rush: Chaplin
  ('8984eb2b-8663-44e8-9312-f88cbf826987'::uuid, 'author_place'),       -- The Ten Commandments: DeMille
  ('73695b38-7e9a-40d4-a610-eb3f8b7a6364'::uuid, 'artist_place'),       -- The Graduate: a crew member's credits
  ('2d651511-78ea-4474-b58e-8c3332264aad'::uuid, 'artist_place'),       -- The Boy Friend: Barbara Windsor
  ('dd6dce74-7daa-4616-95bf-baea03d8e4ef'::uuid, 'artist_place'),       -- The Saint: Roger Moore
  ('9e33cea9-a356-42ad-8f99-338284a61298'::uuid, 'narrative_location'), -- A Bear Called Paddington: arrived at the station
  ('2eb5e886-1b53-48da-ad22-662628a21be4'::uuid, 'narrative_location'), -- Oliver Twist: Nancy's murder on these steps
  ('6de3f20b-4476-46c8-93e1-489843e4a01b'::uuid, 'inspiration_for'),    -- Oliver Twist: the pub behind "The Three Cripples"
  ('361fdea9-e25c-490e-a922-5ce57936d8cb'::uuid, 'inspiration_for'),    -- Roughing It: Dick Stoker became Dick Baker
  ('5c99537a-e8cb-4738-915f-7359475856d0'::uuid, 'inspiration_for'),    -- Brassed Off: the Grimethorpe Colliery Band
  ('4dfa597b-ace4-4188-8bff-e8404fc65eca'::uuid, 'inspiration_for'),    -- The Sound of Music: the von Trapps' forebear
  ('e30a5a27-11f4-4d52-abde-aefe11a7aa54'::uuid, 'replica'),            -- Gone with the Wind: a house modelled on Tara
  ('c32a4f59-7879-47c0-8605-0e1738da5962'::uuid, 'studio_of'),          -- The Wicked Lady: Gainsborough Studios
  ('0b58aa6b-d1f9-4dac-a992-2e47b0be78e0'::uuid, 'studio_of')           -- The Wicked Lady: Gainsborough Studios
)
update work_place_links l
   set relation_kind = d.kind::relation_kind
  from decided d
 where l.id = d.id
   and l.relation_kind = 'filming_location'
   -- The unique key is (work, place, kind): never collide with a link that already says it.
   and not exists (
     select 1 from work_place_links other
      where other.work_id = l.work_id and other.place_id = l.place_id
        and other.relation_kind = d.kind::relation_kind
   );
