export const NARRATOR_PROFILES = {
  neutral: {
    label: "Warm guide",
    voice: "marin",
    instructions: "Speak as a warm, polished museum audio guide. Use natural pacing, clear pronunciation, and understated cinematic energy.",
  },
  archivist: {
    label: "Curious archivist",
    voice: "cedar",
    instructions: "Speak as an original curious city archivist. Sound observant, inviting, and lightly cinematic without imitating any real person.",
  },
};

export function narrationText({ location, story, spoilerFree }) {
  if (!location) return "";

  if (spoilerFree) {
    return `${location.place} is a verified screen or story location connected to ${location.film}. Look around for the setting, architecture, and street details that give this place its character.`;
  }

  return story?.trim() || location.description?.trim() ||
    `${location.place} is a screen or story location connected to ${location.film}.`;
}

export function createSpeechRequest({ text, profileId, model }) {
  const profile = NARRATOR_PROFILES[profileId];

  if (!profile || typeof text !== "string" || !text.trim() || text.length > 600) {
    throw new Error("Invalid narration request");
  }

  return {
    model: model || "gpt-4o-mini-tts",
    voice: profile.voice,
    input: text.trim(),
    instructions: profile.instructions,
    response_format: "mp3",
  };
}
