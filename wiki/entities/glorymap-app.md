# GloryMap — продукт

Карта реальных мест из твоих любимых фильмов, сериалов и книг: личная
коллекция → значимые места города → пеший «стори-маршрут» с аудиогидом.
Хакатон OpenAI Build Week, Тель-Авив, 21.07.2026. Живёт:
https://codex-hackathon-starter.vercel.app

- История имени: SceneMap → **GloryMap** (PR #31); внутренние имена
  компонентов и localStorage-ключи `scenemap-*` сохранены намеренно.
- Слои: [[frontend]] (клиентский монолит) → [[api-layer]] (7 BFF-роутов) →
  [[wikidata]] / [[openai]] / [[external-services]]; [[supabase]] создан, но
  не используется рантаймом.
- Главный сценарий: [[demo-path]]. Фичи: [[personal-library]],
  [[location-discovery]], [[film-imagery]], [[tours-and-voice]],
  [[nearby-geolocation]].
- Приватность: библиотека и фото пользователя не покидают браузер; ключи
  моделей — только server-side.
- Процесс: [[team]], [[deployment-pipeline]], [[testing-conventions]];
  летопись решений — `wiki/log.md` (append-only, новое сверху).
- Продуктовая страница — корневой `README.md` (англ., под Devpost);
  исходный бриф — `Context/brief-scenemap-design.md`.
