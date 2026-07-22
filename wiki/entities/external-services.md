# Внешние сервисы (кроме Wikidata и OpenAI)

Отдельные страницы: [[wikidata]], [[openai]]. Здесь остальное, что дергает
[[api-layer]] и [[frontend]].

## OpenStreetMap-семейство

- **Nominatim** (`/api/cities`): геокод города, format=jsonv2, limit=5,
  радиус из bounding box (кламп 5–50 км), User-Agent `GloryMap/1.0`, кэш 86400.
- **OSRM foot** (`/api/route`): `routing.openstreetmap.de/routed-foot/route/v1/driving`
  — сегмент `driving` в URL это формальность OSRM, профиль пеший задаёт
  `routed-foot`. Переопределяется env `WALKING_ROUTER_URL`. Таймаут 8 с;
  фолбэк на клиенте — прямые линии.
- **Тайлы**: CARTO dark_all поверх OSM — бесплатные, без ключа.

## TMDB

- Только сервер: `api.themoviedb.org/3/movie/{id}/images` → backdrops для
  [[film-imagery]]. Auth: Bearer `TMDB_API_READ_ACCESS_TOKEN` (или
  `TMDB_API_KEY`). Кадры на `image.tmdb.org/t/p/w780{path}`.
- `selectTmdbBackdrops`: дедуп по file_path, сортировка vote_count →
  vote_average → width, до 24 кандидатов в vision.
- file_path валидируется regex `^\/[A-Za-z0-9._-]+$` — защита от инъекции в URL.
- Незадействованный резерв: стиллы эпизодов сериалов
  (`/tv/{id}/season/{s}/episode/{e}/images`) — см. [[personal-collections-matrix]].

## Wikimedia Commons

- Фото «место сейчас» из P18: `commons.wikimedia.org/wiki/Special:FilePath/...`,
  принудительно https. Входит в allowlist референсов vision вместе с
  upload.wikimedia.org и images.unsplash.com (демо-фолбэки).

## Bing Images

- Ссылка «Find scenes filmed here» — просто внешний поисковый URL без ключей;
  исторический фолбэк до появления vision-матчинга.
