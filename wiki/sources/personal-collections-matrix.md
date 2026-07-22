# Матрица источников личных коллекций

Ресёрч 22.07.2026 (9 агентов, ключевые факты проверены живыми запросами).
Вопрос: откуда читать личные коллекции пользователя (фильмы/сериалы/книги/музыка),
чтобы карта [[glorymap-app]] фильтровалась под его вкус. Связано:
[[personal-library]], [[film-imagery]].

## Ярус 1 — «ввёл ник → читаем», без авторизации (проверено живьём)

| Сервис | Регион | Что отдаёт | Как | Сложность |
|---|---|---|---|---|
| **Letterboxd** | global | ~100 последних просмотров: оценка, дата, **готовый tmdb:movieId** | RSS `letterboxd.com/{ник}/rss/`; сервер-сайд с браузерным User-Agent (иначе Cloudflare 403) | easy ★ |
| **Trakt.tv** | global | вся история просмотров, оценки, watchlist публичного профиля (внутри tmdb-ID) | заголовки `trakt-api-key` (client_id) + `trakt-api-version: 2`; OAuth только для приватных; с 30.06.26 обязательная пагинация (limit ≤250) | easy ★ |
| **Кинопоиск** | RU | ~1500 последних оценок по числовому ID профиля | `kinopoiskapiunofficial.tech /api/v1/kp_users/{id}/votes`, бесплатный ключ, 2 req/s | easy |
| **MyShows.me** | RU | весь список сериалов со статусами и оценками по нику | JSON-RPC `api.myshows.me/v2/rpc/` метод `profile.Shows` — без токена вообще | easy |
| **Last.fm** | global | топ-артисты/треки, вся история скробблов по нику | GET с api_key, «does not require authentication» | easy |
| **Goodreads** | global | полки read/to-read: оценки, ISBN, отзывы (~100/фид, по полкам) | RSS `goodreads.com/review/list_rss/{user_id}?shelf=read`; тянуть с бэкенда | easy |
| **AniList** | global | весь аниме/манга-список с оценками | GraphQL `graphql.anilist.co` по нику — даже ключа не надо; 30 req/min | easy |
| **MyAnimeList** | global | аниме/манга-список публичного профиля | заголовок `X-MAL-CLIENT-ID` (ключ мгновенно) | easy |
| **Open Library** | global | reading log по нику | `openlibrary.org/people/{ник}/books/already-read.json` | easy, мало юзеров |
| **ListenBrainz** | global | история прослушиваний по нику | открытый API | easy, мало юзеров |
| **Deezer** | EU | публичные плейлисты по числовому ID профиля | no-auth эндпоинты живы, OAuth мёртв | medium, хрупко |
| **Douban** | CN | ~10 последних отметок | RSS `douban.com/feed/people/{ник}/interests`; полная коллекция — жёсткий антибот | medium |

## Ярус 2 — настоящий OAuth «авторизуйся»

| Сервис | Что | Ограничения (июль 2026) |
|---|---|---|
| **Spotify** | `/me/top/artists`, `/me/top/tracks`, плейлисты, сохранённое | dev mode: **5 тест-юзеров** в allowlist (было 25), владельцу нужен **Premium**, 1 Client ID; для демо жюри ок, «войдёт любой» — нет |
| **Trakt OAuth** | приватные профили, запись | бесплатно, регистрация приложения мгновенная |
| **Simkl** | история, watchlist (сильна в аниме) | OAuth рабочий, аудитория меньше |
| **TMDB** | favorites/rated/watchlist аккаунта | session-based auth; у случайного юзера данные пустые — TMDB держим как базу метаданных |
| **Apple Music** | библиотека, heavy rotation | только с платным Apple Developer ($99) + юзер-подписчик |

## Ярус 3 — «принеси файл» (универсальный fallback)

- **IMDb** — Export → CSV (ratings/watchlist, есть tt-ID); только desktop-сайт. *Уже в приложении.*
- **Letterboxd ZIP** — watched.csv + ratings.csv. *Уже в приложении (25 MB, локально в браузере).*
- **Goodreads CSV**, **StoryGraph CSV**, **Netflix** (Viewing Activity → Download all — жив),
  **LiveLib** (через сторонние экспортёры), **Babelio CSV** (FR).
- **Google Takeout / YouTube** — архив генерится часами, на демо не рассчитывать.

## Мертво / не трогать

Goodreads API (2020), Deezer OAuth, Яндекс.Музыка (токен против ToS),
ЛитРес (только партнёрский договор), Bookmate/Яндекс.Книги (не подтверждено),
Lovelybooks (ничего), Kindle (нет API; только My Clippings.txt с устройства),
скрейпинг IMDb/Кинопоиска (антибот + ToS).

## Идеи: кадры из фильмов («у IMDb куча кадров»)

Прямо с IMDb кадры забрать **нельзя**: API для media нет, галереи за антиботом,
скрейпинг против ToS (лицензирование фото — enterprise через AWS Data Exchange).
Быстрые легальные альтернативы:

1. **TMDB images** — *уже в приложении*: `/api/film-image` сравнивает фото места
   с 24 TMDB-backdrops через Vision с порогом уверенности ([[film-imagery]]).
   Незадействованный резерв: у **сериалов** есть покадровые стиллы эпизодов —
   `GET /tv/{id}/season/{s}/episode/{e}/images` (тот же ключ, тот же CDN).
2. **Fanart.tv API** — курируемые артворки (backgrounds/thumbs) по tmdb/tvdb-ID,
   бесплатный ключ; хорош как второй пул кандидатов для Vision-матчера.
3. **Wikimedia Commons** — категории «Film stills» для старых/PD-фильмов,
   уже используем Commons для «места сейчас», API одинаковый.
4. **YouTube-трейлеры** — официальный трейлер через YouTube Data API →
   стоп-кадры `i.ytimg.com/vi/{id}/maxresdefault.jpg`; законно и мгновенно,
   но кадр один на видео.
5. Скрейп film-grab.com / movie-screencaps / shotdeck — серая зона, **не берём**.

## Идея: «вставь свой ник Letterboxd»

Вкладка Personal Library рядом с ZIP-импортом: поле ника → сервер тянет RSS →
~100 последних фильмов с готовыми tmdb-ID → мгновенное пересечение с картой.
Ноль трения против «скачай ZIP на десктопе»; ZIP остаётся для полной истории.
Тот же паттерн масштабируется: Trakt-ник, Кинопоиск-ID, MyShows-ник, Goodreads-URL
— один экран «подключи коллекцию» с четырьмя полями. Пока НЕ делаем — зафиксировано
как идея (решение владельца 22.07).

## Полный отчёт

Сырой вывод ресёрча с source-URL по каждому утверждению — в выводе workflow
`personal-collections-research` (сессия оператора 22.07.2026); ключевые ссылки
вшиты в таблицы выше.
