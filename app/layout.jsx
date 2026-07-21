import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata = {
  title: "SceneMap",
  description: "Walk through places from your favourite films, series, and books",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
