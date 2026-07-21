"use client";

import dynamic from "next/dynamic";

const SceneMapApp = dynamic(() => import("./components/SceneMapApp"), {
  ssr: false,
  loading: () => (
    <main className="boot-screen">
      <div className="boot-mark" />
      <p>Загружаем карту Лондона...</p>
    </main>
  ),
});

export default function Home() {
  return (
    <SceneMapApp />
  );
}
