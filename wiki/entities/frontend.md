# Frontend — SceneMapApp

Один клиентский монолит `app/components/SceneMapApp.jsx` (~2050 строк) +
`app/components/VoiceGuide.jsx`. Без роутинга и стейт-менеджера: useState/
useRef/useMemo. `app/page.jsx` грузит его через `next/dynamic ssr:false`
(Leaflet требует window). Часть [[glorymap-app]]; серверная сторона —
[[api-layer]].

## Что внутри

- Полноэкранная тёмная карта (CARTO dark_all), командная панель, нижний лист
  локации, модалка RecreateShot (свой кадр поверх референса, фото не покидает
  браузер — objectURL).
- Map-хелперы: RecenterOnSelection, FitRoute, RefreshLocationsOnDrag, FlyToUser.
- Фичи: поиск города и произведения (film|series|book), [[nearby-geolocation]],
  маршрут 3–5 стопов, таймированный тур 30/60/120 и AI-тур ([[tours-and-voice]]),
  [[personal-library]], AI-кадр локации ([[film-imagery]]).

## Паттерны (повторять при правках)

- **Гонки** гасятся ref-счётчиками (locationRequestId, routeRequestId) +
  AbortController: применяется только актуальный ответ.
- **Два режима обновления карты**: drag (`refreshVisibleMap`) сохраняет
  выбор/маршрут/туры; смена города или типа произведения сбрасывает контекст.
- Любая деструктивная операция явно инвалидирует зависимые артефакты
  (aiTour, timedTour, routeResult).
- **Graceful degradation**: /api/route упал → пунктирные прямые линии
  (haversine, 4.6 км/ч); тур без AI → createFallbackGuide; гео запрещена →
  «Use demo location» (Трафальгар).

## Грабли

- localStorage — ровно один ключ `scenemap-library`; город/маршрут/туры
  теряются при перезагрузке.
- После импорта библиотеки авто-включается фильтр `libraryMapOnly` — карта
  может «опустеть», если ничего не смапилось (переключатель в панели My movies).
- Drag карты очищает workQuery — результат поиска произведения живёт до
  первого перетаскивания.
- backdrop без `backdrop_verified === true` отбрасывается ещё в
  locationsFromApi; commons-картинки принудительно https.
- VoiceGuide: Play заблокирован во время воспроизведения — перезапуск только
  через Stop; Spoiler-free включён по умолчанию и подменяет историю шаблоном.
