import OpenAI from "openai";
import { createSpeechRequest } from "../../lib/voice-guide.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  const body = await request.json().catch(() => null);

  let speechRequest;
  try {
    speechRequest = createSpeechRequest({
      text: body?.text,
      profileId: body?.profileId,
      model: process.env.OPENAI_TTS_MODEL,
    });
  } catch {
    return Response.json({ error: "Provide a valid narration and narrator." }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "The OpenAI API key is not configured." }, { status: 503 });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const speech = await openai.audio.speech.create(speechRequest);

    return new Response(speech.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("OpenAI narration generation failed", {
      name: error?.name,
      status: error?.status,
    });

    return Response.json(
      { error: "Could not generate the voice guide. Try again." },
      { status: 502 },
    );
  }
}
