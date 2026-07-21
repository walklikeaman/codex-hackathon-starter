export const NARRATOR_PROFILES = {
  neutral: {
    label: "Neutral guide",
    rate: 0.96,
    pitch: 1,
  },
  archivist: {
    label: "Curious archivist",
    rate: 0.88,
    pitch: 1.08,
  },
};

export function narrationText({ location, story, spoilerFree }) {
  if (!location) return "";

  if (spoilerFree) {
    return `${location.place} is a verified filming location for ${location.film}. Look around for the setting, architecture, and street details that helped shape the scene.`;
  }

  return story?.trim() || location.description?.trim() ||
    `${location.place} is a filming location for ${location.film}.`;
}

export function selectNarratorVoice(voices, profileId) {
  const englishVoices = (Array.isArray(voices) ? voices : []).filter((voice) =>
    voice.lang?.toLowerCase().startsWith("en"),
  );

  if (profileId === "archivist") {
    return englishVoices.find((voice) => !voice.default) || englishVoices[1] || englishVoices[0] || null;
  }

  return englishVoices.find((voice) => voice.default) || englishVoices[0] || null;
}
