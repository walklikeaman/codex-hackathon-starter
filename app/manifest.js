// Installable, because the product is used outdoors (#161, #114).
//
// A phone that has the map on its home screen opens it without a browser chrome, without a
// URL bar eating 60 px of a 812 px screen, and — with the service worker — without the
// network. That is not a convenience here the way it is for a site people read at a desk:
// the moment this product is actually used is the moment its user is on a pavement.
//
// `display: standalone` rather than `fullscreen`: the status bar carries the clock and the
// battery, and somebody following a route across a city wants both.
export default function manifest() {
  return {
    name: "GloryMap",
    short_name: "GloryMap",
    description: "Walk through places from your favourite films, series, and books",
    start_url: "/",
    display: "standalone",
    background_color: "#080909",
    theme_color: "#080909",
    orientation: "any",
    categories: ["travel", "entertainment", "navigation"],
    icons: [
      // One SVG, which every browser that supports `purpose: maskable` also supports as an
      // icon source. A PNG set would be four more files saying the same thing.
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
