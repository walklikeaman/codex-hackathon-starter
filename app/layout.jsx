import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata = {
  title: "GloryMap",
  description: "Walk through places from your favourite films, series, and books",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
