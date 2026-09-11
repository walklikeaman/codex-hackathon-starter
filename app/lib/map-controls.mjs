// The furniture every map has, and the one rule it has to obey.
//
// The map shipped with `zoomControl={false}` and no replacement: there was no way to zoom
// except a trackpad pinch, no way to re-centre on yourself except a button three levels
// down the left panel, and the three basemaps sat as a permanent strip of three buttons
// across the bottom. A reader looking for the controls every other map has found none of
// them, which is what "сделать как у обычных любых картах" is asking for.
//
// **The rule: a control at its limit must say so rather than swallow the click.** The map
// runs `minZoom: 3` to `maxZoom: 19`. At 19 a zoom-in button that still looks pressable is
// a button that lies twice — it invites the click and then does nothing, and the reader
// concludes the map is broken rather than finished. So the affordance is computed, not
// assumed, and the component disables the button the moment the map reports the limit.

export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;

// Leaflet reports fractional zooms while a pinch is in flight, so this compares with a
// tolerance rather than `===`. Without it a button flickers to disabled mid-gesture at
// 18.997 and back at 19, which reads as the control fighting the hand.
const ZOOM_EPSILON = 0.01;

export function zoomAffordance(zoom, bounds = {}) {
  const minZoom = Number.isFinite(bounds.minZoom) ? bounds.minZoom : MIN_ZOOM;
  const maxZoom = Number.isFinite(bounds.maxZoom) ? bounds.maxZoom : MAX_ZOOM;

  // No map yet — the furniture renders before Leaflet is ready, and a control that is
  // dead for one frame must not be a control that is disabled for one frame.
  if (!Number.isFinite(zoom)) return { canZoomIn: true, canZoomOut: true, zoom: null };

  return {
    canZoomIn: zoom < maxZoom - ZOOM_EPSILON,
    canZoomOut: zoom > minZoom + ZOOM_EPSILON,
    zoom,
  };
}

// The layers button replaces a three-button strip with one button and a menu, so the
// button has to say which layer is on WITHOUT the menu being open — otherwise the reader
// has to open it to find out where they are. This is that label.
export function activeLayerLabel(layers, activeId) {
  const active = Array.isArray(layers) ? layers.find((layer) => layer.id === activeId) : null;
  return active?.label ?? "";
}
