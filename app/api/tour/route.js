import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getFilmById, getLocationsForFilm } from "../../lib/scenemap-data";
import { assertCompleteTour, createTourSchema } from "../../lib/tour-schema.mjs";

export const runtime = "nodejs";

const requestSchema = z.object({
  filmId: z.string().min(1),
});

export async function POST(request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "OpenAI API key не настроен" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsedBody = requestSchema.safeParse(body);

  if (!parsedBody.success) {
    return Response.json({ error: "Выберите фильм для экскурсии" }, { status: 400 });
  }

  const film = getFilmById(parsedBody.data.filmId);
  const filmLocations = getLocationsForFilm(parsedBody.data.filmId);

  if (!film || filmLocations.length === 0) {
    return Response.json({ error: "Для этого фильма пока нет проверенных локаций" }, { status: 404 });
  }

  const locationIds = filmLocations.map((location) => location.id);
  const tourSchema = createTourSchema(locationIds);
  const locationBrief = filmLocations.map(({ id, place, scene, description }) => ({
    id,
    place,
    scene,
    description,
  }));

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.parse({
      model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
      store: false,
      max_output_tokens: 700,
      reasoning: { effort: "low" },
      instructions: [
        "Ты лаконичный и увлечённый русскоязычный гид по кинолокациям Лондона.",
        "Составь цельную пешую мини-экскурсию по указанному фильму.",
        "Используй каждую переданную локацию ровно один раз и сохрани её id без изменений.",
        "Выбери драматургически понятный порядок остановок.",
        "Опирайся только на переданные факты: не выдумывай адреса, сцены или координаты.",
        "Для каждой остановки дай 1–2 предложения, которые удобно прочитать вслух на месте.",
      ].join(" "),
      input: `Фильм: ${film.title} (${film.year}).\nИзвестные точки: ${JSON.stringify(locationBrief)}`,
      text: {
        format: zodTextFormat(tourSchema, "film_tour"),
      },
    });

    if (!response.output_parsed) {
      return Response.json({ error: "AI-гид не смог составить эту экскурсию" }, { status: 422 });
    }

    const tour = assertCompleteTour(response.output_parsed, locationIds);

    return Response.json({
      filmId: film.id,
      model: response.model,
      ...tour,
    });
  } catch (error) {
    console.error("AI tour generation failed", {
      name: error?.name,
      status: error?.status,
    });

    return Response.json(
      { error: "Не удалось собрать AI-экскурсию. Попробуйте ещё раз." },
      { status: 502 },
    );
  }
}
