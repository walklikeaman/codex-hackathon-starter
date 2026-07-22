# «Что рядом» — геолокация (issue #17, PR #25)

CTA запрашивает геолокацию только по клику; состояния locating / denied /
unavailable / timeout — каждое с сообщением и кнопкой «Use demo location»
(детерминированный фолбэк — Трафальгарская площадь, выбрана потому, что
попадает в лондонский датасет и карточка nearest всегда заполнена).

- Радиусы 100 м / 300 м / 1 км / 3 км; карта летит к пользователю с зумом
  под радиус, круг радиуса, пульсирующий юзер-пин, ближайший пин со свечением.
- Ближайшая точка показывается даже вне радиуса — с пометкой «outside radius».
- Библиотека: `app/lib/nearby.mjs` (haversine в метрах, findNearby,
  formatDistanceMeters, mapSearchRadiusKm, zoomForRadius) — чистые функции,
  покрыты тестами ([[testing-conventions]]).
- Drag карты тоже обновляет локации: RefreshLocationsOnDrag → browseCenter +
  радиус из вьюпорта, с сохранением выбора/маршрута ([[frontend]]).

Грабля среды: в headless-браузерах без requestAnimationFrame Leaflet flyTo
замирает — анимации проверять на реальном устройстве.
