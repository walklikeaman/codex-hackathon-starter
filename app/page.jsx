export default function Home() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const hasUrl = url.startsWith("https://");
  const hasKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return (
    <main>
      <h1 style={{ fontSize: "1.8rem", lineHeight: 1.2 }}>
        Окружение работает ✅
      </h1>
      <p>
        Стартовое приложение задеплоено. Отсюда команда строит фичи — заполните
        блок «Проект» в <code>AGENTS.md</code> и начинайте.
      </p>
      <ul>
        <li>
          Supabase URL:{" "}
          {hasUrl ? "подключён ✅" : "не настроен — добавьте env в Vercel"}
        </li>
        <li>
          Supabase anon key:{" "}
          {hasKey ? "есть ✅" : "не настроен — добавьте env в Vercel"}
        </li>
      </ul>
    </main>
  );
}
