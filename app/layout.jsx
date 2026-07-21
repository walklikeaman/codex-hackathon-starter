import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata = {
  title: "SceneMap",
  description: "Film walks through locations from your favourite movies",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
