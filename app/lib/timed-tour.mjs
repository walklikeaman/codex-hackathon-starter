export const TOUR_BUDGETS = [30, 60, 120];
const TOUR_MIN_STOPS = 3;
const TOUR_MAX_STOPS = 5;
export const TOUR_BUDGET_TOLERANCE = 1.15;

const WALKING_SPEED_KMH = 4.6;
const STREET_DISTANCE_FACTOR = 1.3;
const MAX_SEEDS = 8;

function isPosition(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

export function distanceKm(from, to) {
  if (!isPosition(from) || !isPosition(to)) return Number.POSITIVE_INFINITY;

  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(to[0] - from[0]);
  const longitudeDelta = toRadians(to[1] - from[1]);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from[0])) *
      Math.cos(toRadians(to[0])) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateTourMinutes(stops) {
  if (!Array.isArray(stops) || stops.length < 2) return 0;

  const directDistanceKm = stops.slice(1).reduce(
    (total, stop, index) =>
      total + distanceKm(stops[index].position, stop.position),
    0,
  );

  return Math.max(
    1,
    Math.ceil((directDistanceKm * STREET_DISTANCE_FACTOR * 60) / WALKING_SPEED_KMH),
  );
}

function nearestNeighborOrder(seed, locations) {
  const remaining = locations.filter((location) => location.id !== seed.id);
  const ordered = [seed];

  while (remaining.length > 0) {
    const previous = ordered.at(-1);
    remaining.sort((left, right) => {
      const distanceDelta =
        distanceKm(previous.position, left.position) -
        distanceKm(previous.position, right.position);

      return distanceDelta || left.id.localeCompare(right.id);
    });
    ordered.push(remaining.shift());
  }

  return ordered;
}

function locationKey(location) {
  if (location.locationId) return `location:${location.locationId}`;

  const [latitude, longitude] = location.position;
  return [
    location.place.trim().toLowerCase(),
    latitude.toFixed(4),
    longitude.toFixed(4),
  ].join(":");
}

function combineLocationWorks(locations) {
  const combined = new Map();

  for (const location of locations) {
    const key = locationKey(location);
    const current = combined.get(key);

    if (!current) {
      combined.set(key, {
        ...location,
        filmIds: location.filmId ? [location.filmId] : [],
        films: location.film ? [location.film] : [],
      });
      continue;
    }

    const filmIds = [...new Set([
      ...current.filmIds,
      ...(location.filmId ? [location.filmId] : []),
    ])];
    const films = [...new Set([
      ...current.films,
      ...(location.film ? [location.film] : []),
    ])];
    const visibleFilms = films.slice(0, 3);
    const filmLabel = [
      visibleFilms.join(", "),
      films.length > visibleFilms.length
        ? `and ${films.length - visibleFilms.length} more`
        : null,
    ].filter(Boolean).join(" ");

    combined.set(key, {
      ...current,
      film: filmLabel,
      filmIds,
      films,
      description: `Verified screen or story location connected to ${filmLabel}.`,
    });
  }

  return [...combined.values()];
}

export function createTimedTourCandidates(locations, origin, budgetMinutes) {
  if (!TOUR_BUDGETS.includes(budgetMinutes)) {
    throw new Error("Tour budget must be 30, 60, or 120 minutes");
  }

  const uniqueLocations = combineLocationWorks([...new Map(
    (Array.isArray(locations) ? locations : [])
      .filter((location) => location?.id && isPosition(location.position))
      .map((location) => [location.id, location]),
  ).values()]);

  if (uniqueLocations.length < TOUR_MIN_STOPS) return [];

  const effectiveOrigin = isPosition(origin) ? origin : uniqueLocations[0].position;
  const nearbySeeds = [...uniqueLocations]
    .sort((left, right) => {
      const distanceDelta =
        distanceKm(effectiveOrigin, left.position) -
        distanceKm(effectiveOrigin, right.position);

      return distanceDelta || left.id.localeCompare(right.id);
    })
    .slice(0, MAX_SEEDS);
  const candidates = new Map();

  for (const seed of nearbySeeds) {
    const ordered = nearestNeighborOrder(seed, uniqueLocations);
    const maximumStops = Math.min(TOUR_MAX_STOPS, ordered.length);

    for (let stopCount = TOUR_MIN_STOPS; stopCount <= maximumStops; stopCount += 1) {
      const stops = ordered.slice(0, stopCount);
      const key = stops.map((stop) => stop.id).join("|");

      if (!candidates.has(key)) {
        candidates.set(key, {
          stops,
          estimatedMinutes: estimateTourMinutes(stops),
          startDistanceKm: distanceKm(effectiveOrigin, stops[0].position),
        });
      }
    }
  }

  const limit = budgetMinutes * TOUR_BUDGET_TOLERANCE;

  return [...candidates.values()]
    .filter((candidate) => candidate.estimatedMinutes <= limit)
    .sort((left, right) =>
      right.stops.length - left.stops.length ||
      left.startDistanceKm - right.startDistanceKm ||
      right.estimatedMinutes - left.estimatedMinutes ||
      left.stops.map((stop) => stop.id).join("|").localeCompare(
        right.stops.map((stop) => stop.id).join("|"),
      ),
    );
}

export function routeFitsBudget(route, budgetMinutes) {
  return (
    Number.isFinite(route?.durationMinutes) &&
    route.durationMinutes <= budgetMinutes * TOUR_BUDGET_TOLERANCE
  );
}

export function createFallbackGuide({ city, budgetMinutes, stops }) {
  return {
    title: `${budgetMinutes}-minute GloryMap walk · ${city}`,
    intro: `A nearby ${stops.length}-stop route built from verified screen and story locations.`,
    stops: stops.map((location) => ({
      locationId: location.id,
      narration: location.description,
    })),
  };
}
