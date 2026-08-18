# The place card — tabs, a takeable coordinate, and two different numbers

What the card does now, and the three bugs found while making it do it (#160). Related:
[[three-axes]], [[place-precision]], [[directory]].

## Tabs, and the one that is not there

The card was a single scroll holding the sentence, the precision badge, the evidence, the
voice guide, two images, "Recreate this shot", three external links and "Add to route" —
unrelated things in one column, with the route controls pushing the sentence about the
place out of sight. It is now **Details / Route**.

**There is no Discussion tab.** The reference has one and #157 is not built; a tab that
opens onto nothing is the padding this project refuses elsewhere. `PLACE_TABS` in
[app/lib/place-card.mjs](app/lib/place-card.mjs) is where it goes the day #157 lands, one
line, without rearranging the card again.

**The card reopens on Details whenever the place changes.** Otherwise clicking a new pin
shows route controls where the sentence should be, which is the thing tabs were meant to
stop.

The Route tab says something before anything is on the route — *"Nothing on your route yet.
This place can be the first stop."* — and names the limits instead of enforcing them
silently: the old button simply did nothing at five stops, which reads as a broken button
rather than as a full route.

## The coordinate

Printed at four decimals and copied at four decimals. **A copy button that hands over more
precision than the page displayed is inventing digits** — most of these were located from a
gazetteer, not with a theodolite; six decimals is 11 cm.

The copied text is a bare pair, `51.4969, -0.1716`, with no label and no degree signs,
because it is pasted into a maps app and not into an essay. `(0, 0)` is never copyable:
`Number("")` is 0 and 0 is finite, and this project has had four Null Island incidents.

**Clipboard failure is reported, not swallowed.** `navigator.clipboard` is undefined outside
a secure context and rejects when the document is not focused. Verified: in a headless
context the write is refused and the card says *"Copying was blocked — select the number and
copy it by hand."* A copy button that silently does nothing is worse than one that admits it.

## Two numbers, and why one was not enough

The panel said `10 in London` — how many rows it was listing. That could not distinguish
**"we hold little here"** from **"you are zoomed too far out"**, which is the whole reason
the reference prints "8 LOCATIONS VISIBLE". It now says *"6 places from 4 films"*, places
first because places are what is drawn.

Three things this cost, each found by looking rather than by reasoning:

- **The count is not debounced and the fetch still is.** They are different costs: the fetch
  is a network request per gesture, the count is a filter over a list already in memory.
  Debouncing the count leaves the panel describing the previous viewport for 400 ms after
  every drag — the one moment somebody is actually reading it.
- **A map with no size has not said what is in view.** Leaflet answers `getBounds()` on a
  zero-sized container with a degenerate box. Observed on the first paint: *"No places in
  view"* printed over a map already drawing five pins. `isUsableBounds` treats a box with no
  height as *unknown*, and unknown means everything counts.
- **The list and its heading must be one truth.** Counting the viewport while listing the
  whole selection put "6 places from 4 films" above ten rows — a header contradicting the
  thing it heads. The list is now filtered by the same function, and when the selection has
  places but none are on screen it says so, which is exactly the distinction the issue asked
  for.

Longitude wraps and latitude does not, so a viewport across the antimeridian arrives with
`west > east`; a plain between-test answers zero for the entire Pacific, which reads as "we
hold nothing there" rather than as a broken test. There is a test.

## Two CSS bugs worth naming, because both looked like logic bugs

- **`[hidden]` loses to any class that sets `display`.** The browser's own
  `[hidden] { display: none }` is a bare attribute selector, so `.place-route-panel {
  display: grid }` outranked it and both tabs rendered at once — route controls underneath
  the voice guide. The rule is `.place-route-panel:not([hidden])`.
- **`.wide-button` had no disabled appearance.** `.primary-button:disabled` dims and
  `.wide-button:disabled` did not, so a button that refuses to act looked identical to one
  that would. It predates this work — "Recreate this shot" without a reference image has
  always looked clickable — and the Route tab put "Build route" in front of the reader every
  time, which is what made it visible.

## Not taken

**Their 1–5 safety score.** It exists because their readers climb into derelict buildings;
ours walk to a café on a public street. We already carry the two badges that matter here —
precision and evidence ([[three-axes]]) — and both are better calibrated than a number
nobody could source.
