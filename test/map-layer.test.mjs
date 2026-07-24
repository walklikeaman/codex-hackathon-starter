import assert from "node:assert/strict";
import test from "node:test";

import {
  BADGE_STYLES,
  badgeStyle,
  clusterRadius,
  clusterStyle,
  pointStyle,
  pointSummary,
  viewportQuery,
} from "../app/lib/map-layer.mjs";

const feature = (badge, properties = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-0.128, 51.508] },
  properties: { badge, work_count: 2, ...properties },
});

test("every badge has a distinct look, so four different claims never read alike", () => {
  const keys = Object.keys(BADGE_STYLES);
  assert.deepEqual(keys.sort(), ["approximate", "exact", "narrative", "studio"]);
  // Colour alone isn't enough (exact and approximate share the amber), so the pair
  // must differ in something else a viewer can see.
  const exact = BADGE_STYLES.exact;
  const approx = BADGE_STYLES.approximate;
  assert.notEqual(exact.dashArray, approx.dashArray);
  assert.ok(approx.radius > exact.radius);
  assert.ok(approx.fillOpacity < exact.fillOpacity);
  // Studio and narrative are distinguished by colour.
  assert.notEqual(BADGE_STYLES.studio.color, BADGE_STYLES.exact.color);
  assert.notEqual(BADGE_STYLES.narrative.color, BADGE_STYLES.exact.color);
});

test("an approximate point is drawn as a region, never as a doorstep", () => {
  const style = badgeStyle("approximate");
  assert.ok(style.radius >= 12);
  assert.ok(style.dashArray);
  assert.match(style.hint, /city or country/i);
});

test("a studio says the story is set elsewhere", () => {
  assert.match(badgeStyle("studio").hint, /elsewhere/i);
});

test("badgeStyle falls back instead of throwing on an unknown badge", () => {
  assert.deepEqual(badgeStyle("nonsense"), BADGE_STYLES.exact);
  assert.deepEqual(badgeStyle(undefined), BADGE_STYLES.exact);
});

test("selection grows the ring but keeps what the point IS", () => {
  const base = badgeStyle("studio");
  const selected = pointStyle(feature("studio"), { selected: true });
  assert.ok(selected.radius > base.radius);
  assert.equal(selected.fillColor, base.fillColor); // identity survives selection
  assert.equal(pointStyle(feature("studio")).radius, base.radius);
});

test("cluster bubbles stay visibly distinct across the whole range", () => {
  // A scale that saturates early would draw 50 and 5000 identically — telling the
  // reader those two clusters are the same size.
  assert.ok(clusterRadius(1) < clusterRadius(50));
  assert.ok(clusterRadius(50) < clusterRadius(500));
  assert.ok(clusterRadius(500) < clusterRadius(5000));
  assert.equal(clusterRadius(100000), 30); // clamped, so one cell can't swallow the map
  assert.equal(clusterRadius(0), 12);
  assert.equal(clusterRadius(undefined), 12);
});

test("a cluster containing a studio is marked as such", () => {
  assert.equal(clusterStyle(5, { hasStudio: true }).color, BADGE_STYLES.studio.color);
  assert.equal(clusterStyle(5).color, BADGE_STYLES.exact.color);
});

// --- viewport ----------------------------------------------------------------

const bounds = (west, south, east, north) => ({
  getWest: () => west, getSouth: () => south, getEast: () => east, getNorth: () => north,
});

test("viewportQuery builds the endpoint query from Leaflet bounds", () => {
  const query = new URLSearchParams(viewportQuery(bounds(-0.35, 51.35, 0.05, 51.65), 13));
  assert.equal(query.get("west"), "-0.35");
  assert.equal(query.get("east"), "0.05");
  assert.equal(query.get("z"), "13");
  assert.equal(query.get("workId"), null);
});

test("viewportQuery preserves a date-line-crossing viewport", () => {
  // Sorting west/east here would ask the API for the complement of what the user sees.
  const query = new URLSearchParams(viewportQuery(bounds(170, -10, -170, 10), 13));
  assert.equal(query.get("west"), "170");
  assert.equal(query.get("east"), "-170");
});

test("viewportQuery clamps longitudes Leaflet reports outside the world", () => {
  // After wrapping, Leaflet happily returns e.g. -190; the API would reject it.
  const query = new URLSearchParams(viewportQuery(bounds(-190, -95, 190, 95), 4));
  assert.equal(query.get("west"), "-180");
  assert.equal(query.get("east"), "180");
  assert.equal(query.get("south"), "-90");
  assert.equal(query.get("north"), "90");
});

test("viewportQuery passes the work and kind filters through", () => {
  const query = new URLSearchParams(
    viewportQuery(bounds(-1, 51, 1, 52), 13, { workId: "abc", kinds: ["film", "book"] }),
  );
  assert.equal(query.get("workId"), "abc");
  assert.equal(query.get("kinds"), "film,book");
});

test("viewportQuery returns null for unusable bounds instead of a bad request", () => {
  assert.equal(viewportQuery(null, 13), null);
  assert.equal(viewportQuery(bounds(NaN, 51, 1, 52), 13), null);
});

test("pointSummary reads as a plain sentence about the claim", () => {
  assert.equal(pointSummary({ badge: "studio", work_count: 1 }), "Studio · 1 work");
  assert.equal(pointSummary({ badge: "exact", work_count: 3 }), "Filmed here · 3 works");
  assert.equal(pointSummary(null), "");
});
