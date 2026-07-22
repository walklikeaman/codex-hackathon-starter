# API-слой — 7 роутов Next.js

Backend-for-frontend: route-хэндлеры делают сетевые вызовы, вся логика
вынесена в чистые `app/lib/*.mjs` (тестируемые без сети —
[[testing-conventions]]). Потребитель — [[frontend]].

| Роут | Что делает | Внешнее |
|---|---|---|
| GET `/api/cities?q=` | геокод города → {name, lat, lng, radius_km 5–50, wikidata_id} | Nominatim, кэш 86400 |
| GET `/api/locations` | ядро: nearby-режим (SPARQL `wikibase:around`) или work-режим (`?q=` → wbsearchentities → валидация типа по графу P31/P279 BFS≤4 → локации по P915/P840) | [[wikidata]], кэш 3600 |
| POST `/api/locations/discover` | AI-дорасследование при скудной выдаче ([[location-discovery]]) | [[openai]] web_search |
| GET `/api/film-image` | кадр фильма для локации через vision-гейт ([[film-imagery]]) | Wikidata+TMDB+vision |
| POST `/api/route` | пеший маршрут 2–5 точек | OSRM ([[external-services]]) |
| POST `/api/tour` | тексты тура Structured Outputs, id стопов через z.enum | [[openai]] gpt-5.6-terra |
| POST `/api/narration` | TTS mp3-стрим, текст ≤600 символов | [[openai]] gpt-4o-mini-tts |

## Сквозные решения

- Модели не доверяют: каждый LLM-ответ валидируется кодом (assertCompleteTour,
  normalizeDiscoveredLocations, только confidence='high').
- Каждый внешний вызов — AbortSignal.timeout (6–20 с), таймаут → 504,
  сбой → 502; Wikidata — 1 ретрай на 429/503.
- Кэш двухслойный: `next:{revalidate}` на fetch + `s-maxage` на ответах.
- Prompt-injection защита во всех LLM-инструкциях + allowlist https-хостов
  референс-картинок.
- Отсутствие ключей TMDB/OpenAI — не 5xx, а 200 с `image_url:null` + `reason`.

## Грабли

- Дефолт `/api/locations` без lat/lng — молча Лондон.
- Негативные ответы film-image идут со статусом 200 — клиент смотрит `reason`,
  не HTTP-статус; кэшируются на CDN сутки.
- Rate limiter film-image in-memory на инстанс — на serverless мягче заявленных
  12/10мин.
- geo-поиск фильмов использует точный `wdt:P31 wd:Q11424` без P279* (перф);
  подклассы фильма находит только work-режим.
