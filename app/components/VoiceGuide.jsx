"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Square, Volume2 } from "lucide-react";
import {
  NARRATOR_PROFILES,
  narrationText,
  selectNarratorVoice,
} from "../lib/voice-guide.mjs";

export default function VoiceGuide({ location, story }) {
  const utteranceRef = useRef(null);
  const [supported, setSupported] = useState(null);
  const [voices, setVoices] = useState([]);
  const [profileId, setProfileId] = useState("neutral");
  const [spoilerFree, setSpoilerFree] = useState(true);
  const [speechState, setSpeechState] = useState("idle");
  const [message, setMessage] = useState("");
  const text = useMemo(
    () => narrationText({ location, story, spoilerFree }),
    [location, spoilerFree, story],
  );

  useEffect(() => {
    const available =
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      "SpeechSynthesisUtterance" in window;
    setSupported(available);

    if (!available) return undefined;

    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (supported) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeechState("idle");
    setMessage("");
  }, [location?.id, profileId, spoilerFree, story, supported]);

  function play() {
    if (!supported || !text) return;

    window.speechSynthesis.cancel();
    const profile = NARRATOR_PROFILES[profileId];
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = selectNarratorVoice(voices, profileId);

    utterance.lang = voice?.lang || "en-GB";
    utterance.voice = voice;
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    utterance.onend = () => {
      utteranceRef.current = null;
      setSpeechState("idle");
      setMessage("Narration finished.");
    };
    utterance.onerror = (event) => {
      utteranceRef.current = null;
      setSpeechState("idle");
      setMessage(
        event.error === "canceled" || event.error === "interrupted"
          ? "Narration stopped."
          : "Voice playback failed. You can still read the story above.",
      );
    };

    utteranceRef.current = utterance;
    setMessage("");
    setSpeechState("playing");
    window.speechSynthesis.speak(utterance);
  }

  function togglePause() {
    if (!supported) return;

    if (speechState === "playing") {
      window.speechSynthesis.pause();
      setSpeechState("paused");
      setMessage("Narration paused.");
    } else if (speechState === "paused") {
      window.speechSynthesis.resume();
      setSpeechState("playing");
      setMessage("");
    }
  }

  function stop() {
    if (!supported) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeechState("idle");
    setMessage("Narration stopped.");
  }

  if (supported === false) {
    return (
      <section className="voice-guide is-unavailable" aria-label="Voice guide">
        <Volume2 size={18} />
        <span>Voice playback is not supported in this browser. The story remains available above.</span>
      </section>
    );
  }

  return (
    <section className="voice-guide" aria-label="Voice guide">
      <div className="voice-guide-heading">
        <span><Volume2 size={18} /> Voice guide</span>
        <label className="spoiler-toggle">
          <input
            type="checkbox"
            checked={spoilerFree}
            onChange={(event) => setSpoilerFree(event.target.checked)}
          />
          Spoiler-free
        </label>
      </div>
      <label className="narrator-select">
        <span>Narrator</span>
        <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
          {Object.entries(NARRATOR_PROFILES).map(([id, profile]) => (
            <option key={id} value={id}>{profile.label}</option>
          ))}
        </select>
      </label>
      <div className="voice-controls">
        <button type="button" onClick={play} disabled={supported !== true || speechState !== "idle"}>
          <Play size={15} /> Play
        </button>
        <button type="button" onClick={togglePause} disabled={!['playing', 'paused'].includes(speechState)}>
          {speechState === "paused" ? <Play size={15} /> : <Pause size={15} />}
          {speechState === "paused" ? "Resume" : "Pause"}
        </button>
        <button type="button" onClick={stop} disabled={speechState === "idle"}>
          <Square size={14} /> Stop
        </button>
      </div>
      <p className="voice-status" aria-live="polite">
        {message || (speechState === "playing" ? `Playing as ${NARRATOR_PROFILES[profileId].label.toLowerCase()}.` : "Ready to play a short original recap.")}
      </p>
    </section>
  );
}
