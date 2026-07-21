import { z } from "zod";

export function createTourSchema(locationIds) {
  if (locationIds.length === 0) {
    throw new Error("A tour needs at least one known location");
  }

  const locationId = z.enum(locationIds);

  return z.object({
    title: z.string().min(1).max(90),
    intro: z.string().min(1).max(320),
    stops: z
      .array(
        z.object({
          locationId,
          narration: z.string().min(1).max(260),
        }),
      )
      .length(locationIds.length),
  });
}

export function assertCompleteTour(tour, locationIds) {
  const returnedIds = tour.stops.map((stop) => stop.locationId);
  const uniqueIds = new Set(returnedIds);

  if (
    uniqueIds.size !== locationIds.length ||
    locationIds.some((locationId) => !uniqueIds.has(locationId))
  ) {
    throw new Error("The model returned an incomplete or duplicated route");
  }

  return tour;
}
