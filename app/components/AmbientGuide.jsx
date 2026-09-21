"use client";

// Listen as you walk (#190): the guide talks about what you pass, with no route chosen.
//
// The choosing, pacing and wording are in app/lib/ambient-walk.mjs, where they are
// measured and tested. This component only does the three things a browser makes hard:
//
//   * Audio must be unlocked by a tap. iOS allows playback only from an element that was
//     first played inside a user gesture, so the start button plays a silent clip on the
//     ONE <audio> element every telling then reuses. A new Audio() per telling would be
//     blocked on the first place, with nothing left to tap.
//   * The screen must stay on, or watchPosition stops firing in a pocket.
//   * The feed is re-read as the walker moves, not polled on a timer: standing still
//     costs nothing.

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, SkipForward, Square } from "lucide-react";

import useWakeLock from "./useWakeLock.js";
import {
  QUIET_GAP_MS, feedNeedsRefresh, feedUrl, nearbyFromMapResponse, pickAmbient, tellingFor,
} from "../lib/ambient-walk.mjs";
import { hasMovedEnough, isUsableFix } from "../lib/geo-trigger.mjs";
import { ROAD_SAFETY_REMINDER } from "../lib/walk-mode.mjs";

const SILENCE = "/silence.mp3";

export default function AmbientGuide({ onPlace, onListeningChange }) {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("idle");
  const [nearbyCount, setNearbyCount] = useState(null);
  const [current, setCurrent] = useState(null);
  const [told, setTold] = useState(0);
  const [gpsWarning, setGpsWarning] = useState(false);

  const audioRef = useRef(null);
  const placesRef = useRef([]);
  const feedCentreRef = useRef(null);
  const feedAbortRef = useRef(null);
  const tellAbortRef = useRef(null);
  const lastFixRef = useRef(null);
  const spokenRef = useRef([]);
  const busyRef = useRef(false);
  const quietUntilRef = useRef(0);
  const objectUrlRef = useRef("");

  useWakeLock(listening);
  useEffect(() => { onListeningChange?.(listening); }, [listening, onListeningChange]);

  const releaseClip = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = "";
  }, []);

  const finishTelling = useCallback(() => {
    busyRef.current = false;
    quietUntilRef.current = Date.now() + QUIET_GAP_MS;
    releaseClip();
    setCurrent(null);
    setStatus("listening");
  }, [releaseClip]);

  const tell = useCallback(async (place) => {
    busyRef.current = true;
    // Recorded as told BEFORE anything is fetched: every fix that arrives while the
    // sentence is being prepared would otherwise pick the same place again.
    spokenRef.current = [...spokenRef.current, { id: place.id, position: place.position }];
    setCurrent({ name: place.name, checked: place.checked });
    setStatus("preparing");
    onPlace?.(place);

    const controller = new AbortController();
    tellAbortRef.current = controller;
    try {
      const text = await tellingFor(place, { signal: controller.signal });
      if (!text) { finishTelling(); return; }
      const response = await fetch("/api/narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, profileId: "neutral" }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`narration ${response.status}`);
      const blob = await response.blob();
      const audio = audioRef.current;
      if (!audio || controller.signal.aborted) return;
      releaseClip();
      objectUrlRef.current = URL.createObjectURL(blob);
      audio.src = objectUrlRef.current;
      audio.onended = finishTelling;
      audio.onerror = finishTelling;
      setStatus("speaking");
      setTold((count) => count + 1);
      await audio.play();
    } catch (error) {
      if (error?.name === "AbortError") return;
      // A place that failed is not retried: the walker has moved on, and a retry loop
      // on one building is worse than one silence.
      finishTelling();
    }
  }, [finishTelling, onPlace, releaseClip]);

  const refreshFeed = useCallback(async (position) => {
    const url = feedUrl(position);
    if (!url) return;
    feedCentreRef.current = position;
    feedAbortRef.current?.abort();
    const controller = new AbortController();
    feedAbortRef.current = controller;
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return;
      placesRef.current = nearbyFromMapResponse(await response.json());
      setNearbyCount(placesRef.current.length);
    } catch {
      // Offline or a failed read keeps the last feed: the places behind the walker are
      // still true, and the service worker may still answer the next one.
    }
  }, []);

  useEffect(() => {
    if (!listening || typeof navigator === "undefined" || !navigator.geolocation) return undefined;

    const watch = navigator.geolocation.watchPosition(
      async (fix) => {
        const position = { coords: [fix.coords.latitude, fix.coords.longitude], accuracy: fix.coords.accuracy };
        if (!isUsableFix(position)) { setGpsWarning(true); return; }
        setGpsWarning(false);
        if (!hasMovedEnough(lastFixRef.current, position.coords)) return;
        lastFixRef.current = position.coords;

        if (feedNeedsRefresh(feedCentreRef.current, position.coords)) await refreshFeed(position.coords);

        const hit = pickAmbient(placesRef.current, position, {
          spoken: spokenRef.current,
          busy: busyRef.current,
          quietUntil: quietUntilRef.current,
        });
        if (hit) tell(hit.place);
      },
      () => setGpsWarning(true),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [listening, refreshFeed, tell]);

  const start = () => {
    // Inside the tap, and on the element every telling will reuse. This is the unlock.
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    // Left over from a previous listen, these would treat the silent clip's end as a
    // telling finishing and start a quiet gap before anything was said.
    audio.onended = null;
    audio.onerror = null;
    audio.src = SILENCE;
    audio.play().catch(() => {});
    spokenRef.current = [];
    quietUntilRef.current = 0;
    busyRef.current = false;
    feedCentreRef.current = null;
    lastFixRef.current = null;
    setTold(0);
    setNearbyCount(null);
    setStatus("listening");
    setListening(true);
  };

  const stop = () => {
    setListening(false);
    tellAbortRef.current?.abort();
    feedAbortRef.current?.abort();
    audioRef.current?.pause();
    busyRef.current = false;
    releaseClip();
    setCurrent(null);
    setStatus("idle");
  };

  const skip = () => {
    tellAbortRef.current?.abort();
    audioRef.current?.pause();
    finishTelling();
  };

  useEffect(() => () => {
    tellAbortRef.current?.abort();
    feedAbortRef.current?.abort();
    audioRef.current?.pause();
    releaseClip();
  }, [releaseClip]);

  if (!listening) {
    return (
      <button className="walk-start ambient-start" type="button" onClick={start}>
        <Headphones size={16} />
        <span>Listen as I walk</span>
      </button>
    );
  }

  return (
    <div className="walk-active ambient-active" role="region" aria-label="Listening as you walk" aria-live="polite">
      <div className="walk-row">
        <strong>
          {current
            ? current.name ?? "A place nearby"
            : nearbyCount === null
              ? "Finding where you are…"
              : nearbyCount === 0
                ? "Nothing recorded around here"
                : `${nearbyCount} place${nearbyCount === 1 ? "" : "s"} around you`}
        </strong>
        <button aria-label="Stop listening" className="walk-stop" onClick={stop} type="button">
          <Square size={14} />
        </button>
      </div>

      {current && (
        <div className="walk-row">
          {/* The hollow pin cannot be seen while listening, so its meaning is written. */}
          <small className={current.checked ? "ambient-checked" : "ambient-unchecked"}>
            {status === "preparing" ? "Getting ready… · " : ""}
            {current.checked ? "Checked place" : "Listed by a source, not checked by us"}
          </small>
          <button aria-label="Skip this place" className="walk-stop" onClick={skip} type="button">
            <SkipForward size={14} />
          </button>
        </div>
      )}

      {!current && (
        <small>
          {told > 0 ? `${told} told so far. ` : ""}The guide speaks when you pass within 45 m of a place.
        </small>
      )}

      {gpsWarning && (
        <small className="walk-warning">Waiting for a better GPS fix — nothing will play until then.</small>
      )}
      <small className="walk-safety">{ROAD_SAFETY_REMINDER}</small>
    </div>
  );
}
