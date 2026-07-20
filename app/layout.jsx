export const metadata = {
  title: "Codex Hackathon",
  description: "Стартовое окружение команды",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          padding: "3rem 1.5rem",
          lineHeight: 1.6,
          maxWidth: 640,
          marginInline: "auto",
          color: "#1b1e23",
        }}
      >
        {children}
      </body>
    </html>
  );
}
