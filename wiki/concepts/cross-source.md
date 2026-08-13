# Cross-source corroboration — the only evidence our scrapes carry at scale

Code: `app/lib/cross-source.mjs`, `scripts/corroborate-sources.mjs`, and the
`independent_corroboration` signal in `app/lib/place-review.mjs`.

Three sites name places for the same films. Where two of them name the SAME
place, that agreement is evidence — not one contributor trusted twice, but two
sets of people arriving at the same address separately. Nothing else in
[[moviemaps-source]], [[reelstreets-source]] or [[movielocations-source]]
provides it.

It also carries a coordinate. MovieMaps measures 30,153 points; the other two
measure almost none, and the review gate refuses any row without one before
scoring begins. A matched pair lets the pointless row borrow a point somebody
else measured — recorded as `geocode_reason = 'matched_place_in_another_source'`,
because a borrowed coordinate is a different fact from a measured one.

## The rule was read off the data, not chosen

4,681 pairs shared a distinctive word without matching under
[[place-precision]]'s strict `namesMatch`. Judged by hand across bands of
similarity, and the decisive finding was not a threshold but **which word is
shared**:

> `560 Granville Street` / `Smithfield Street, London EC1`
> `Broughton Castle` / `Arundel Castle, West Sussex`

Both share a word naming the KIND of place. In the least-similar band that
single filter removes 2,235 of 2,733 pairs. What remains at 0.4 overlap and
above was true in every sample: `Lacock Abbey` against `Sacristy, Lacock Abbey,
Lacock, Wiltshire` is the same abbey with a room named inside it.

**"One name contains the other" was tried and rejected**, here as in
`wikidata-resolve.mjs`: a substring catches neighbours, the case turns
ambiguous, and an ambiguous case is correctly discarded. It resolved *fewer*
pairs than the strict rule.

## The trap a test caught before the data did

The first version matched **National Gallery** to **National Portrait Gallery**
— two museums in the same square. Forty judged pairs had shown no false
positives, and this whole class was still missed: an extra word sitting INSIDE
the name, changing which institution it is.

Where extra words are administrative context they arrive as their own
comma-separated part, so a part of the longer name still reads exactly as the
shorter one — `Rosslyn Chapel, Roslin, Midlothian`. That is the guard.

It knowingly loses true matches: `Old Royal Naval College` against `the Painted
Hall of the Royal Naval College` is the same institution and is structurally
identical to the National Gallery pair. No rule can separate them, and the
conservative direction is the right one — **a false agreement tells a reviewer
two sources concur when only one does.**

## Weight, and why it cannot publish alone

`independent_corroboration` is 0.5 against a 0.6 threshold, so it needs a second
signal: with `coordinate_agreement` it reaches 0.625 and clears the bar. Alone
it does not, and that is deliberate. All three sites are scrapes of secondary
material with no editorial process, and **their independence is an assumption we
cannot verify** — two compilations that copied a common ancestor look exactly
like two people who each went and looked.

Measured before the weight was chosen: of the corroborated rows, essentially all
have exactly one agreeing source. A tier for "three or more" would have been a
rule about two rows.

## Retraction is part of the pass

The pass recomputes from scratch, because a rule change is exactly when it is
re-run. A version that only ever wrote left 298 rows carrying agreement the
corrected rule had withdrawn.

Paged reads are ordered by id, and that is not cosmetic: Postgres gives no
stable order across pages without one. The first run wrote 1,741 updates and
left 1,733 rows — eight read twice, eight never read at all.

See also: [[moviemaps-source]], [[reelstreets-source]], [[movielocations-source]],
[[queue-review]].
