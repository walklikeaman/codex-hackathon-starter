-- The relations a fact about a PERSON needs, and the one a recording needs (#129).
--
-- Alone in its own migration for the reason moviemaps_source_kind, reelstreets_source_kind
-- and movielocations_source_kind are each alone in theirs: Postgres refuses to USE a new
-- enum value in the transaction that created it, and the next migration both constrains
-- and reads these.
--
-- Why these seven and not a generic 'person_place': the whole point of storing a fact
-- rather than a link is that the card can say what happened. "J. K. Rowling lived here"
-- and "J. K. Rowling is buried here" are not the same sentence, and `author_place` — the
-- value we have today — cannot tell them apart. A plaque states which one it is; throwing
-- that away at the door is how a wall of text becomes "This place is connected with the
-- work".
--
-- `recorded_at` is the work-side relation #128 needs: Wikidata P483 gives 5,464 recordings
-- whose studio carries a coordinate, and filing those as `filming_location` would be false
-- in the same way `replica` was before 20260805000000.

alter type relation_kind add value if not exists 'lived_here';
alter type relation_kind add value if not exists 'worked_here';
alter type relation_kind add value if not exists 'wrote_here';
alter type relation_kind add value if not exists 'died_here';
alter type relation_kind add value if not exists 'buried_here';
alter type relation_kind add value if not exists 'commemorated_here';
alter type relation_kind add value if not exists 'recorded_at';
