import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata = {
  title: "SceneMap",
  description: "Кино-прогулки по местам из любимых фильмов",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
