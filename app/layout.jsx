import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata = {
  title: "GloryMap",
  description: "Walk through places from your favourite films, series, and books",
};

// viewport-fit=cover is what makes env(safe-area-inset-*) resolve to anything on a
// notched iPhone; without it the bottom sheet sits under the home indicator and the
// top panel under the Dynamic Island. maximumScale is deliberately left alone —
// blocking zoom would make the map unusable for anyone who needs to magnify it.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080909",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
