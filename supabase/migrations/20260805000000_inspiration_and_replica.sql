-- Two relations the map could not express, and had to lie or stay silent about.
--
-- `relation_kind` was ('filming_location','narrative_location','author_place',
-- 'artist_place','studio_of'). Measured against the tours we intend to replace, that
-- leaves two of the commonest stops in the world unrepresentable.
--
-- INSPIRATION_FOR. Thomas Riddell's grave in Greyfriars Kirkyard is not a filming
-- location and is not where the story is set — Harry Potter does not happen there.
-- It is where a name came from. The inverted search ALREADY FINDS IT, along with
-- Marchmont, Leith Academy and Moray House, and today there is nowhere to put the
-- answer: either file it as `filming_location`, which is false, or drop it, which is
-- what happens.
--
-- REPLICA. Bagshot Row's interior and the Green Dragon at Hobbiton were built for
-- visitors and never shot in. The trolley in the wall at King's Cross is on a
-- concourse; the films used platforms 4 and 5. Filed as `filming_location` these
-- become exactly the kind of confident false claim the whole grounding invariant
-- exists to prevent — and worse than an imprecise pin, because nothing about them
-- looks wrong.
--
-- `author_place` already covers Marchmont and Leith Academy, so it is left alone.

alter type relation_kind add value if not exists 'inspiration_for';
alter type relation_kind add value if not exists 'replica';
