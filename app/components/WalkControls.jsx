"use client";

// Walk mode, on the map where it belongs (#63, #64).
//
// The logic for both has been shipped and tested for a while and has shown nothing to
// anyone, because every new thing was queued behind "where does it go in the panel?".
// The answer is that it does not: the panel is for choosing what to see, the map is
// for being outside. A control you need while walking must not live inside a sheet you
// have to open.
//
// Three things this has to get right, all of them learned in the modules underneath:
//
//   * Audio cannot start by itself. Browsers block it, so `playbackState` has a
//     "needs-unlock" state and the walker is asked for one tap UP FRONT — otherwise
//     they reach the first stop and hear silence, with nothing to tap, because the
//     whole promise was that no tapping is needed.
//   * The screen must stay awake, and the lock must be RE-acquired when the tab comes
//     back; a wake lock is dropped silently on hide.
//   * A vague GPS fix is not a location. Below the accuracy gate nothing fires, since
//     a trigger is a claim about where someone is standing.

import { useEffect, useRef, useState } from "react";
import { Footprints, Play, SkipForward, Square, Volume2 } from "lucide-react";

import AmbientGuide from "./AmbientGuide.jsx";
import useTellingPlayer from "./useTellingPlayer.js";
import useWakeLock from "./useWakeLock.js";
import { trailStopText } from "../lib/ambient-walk.mjs";
import { advanceTriggers, hasMovedEnough, isUsableFix, playbackState, UNLOCK_PROMPT } from "../lib/geo-trigger.mjs";
import { nextStop, ROAD_SAFETY_REMINDER, walkBanner } from "../lib/walk-mode.mjs";

export default function WalkControls({ stops, onNarrate, onNextStopChange, onAmbientPlace }) {
  const [walking, setWalking] = useState(false);
  // Listening and walking a trail are two voices; only one may run.
  const [listening, setListening] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [position, setPosition] = useState(null);
  const [accuracyWarning, setAccuracyWarning] = useState(false);
  const [visitedIds, setVisitedIds] = useState([]);
  // A ref, not state: recording that a stop already spoke must not itself re-render
  // and re-run the effect that does the recording.
  const triggerState = useRef({});
  const lastFix = useRef(null);
  // The trail spoke to nobody: arrival re-centred the map and that was all (#190). It
  // now says the graph's sentence for this film at this stop, through the same player
  // "Listen as I walk" uses — one unlock, one voice, one way of failing quietly.
  const player = useTellingPlayer();
  const playerRef = useRef(player);
  playerRef.current = player;
  // The parent passes a new arrow on every render, and every map move is a render. As a
  // dependency it tore down and re-created the position watch each time — a fresh
  // watchPosition per pan while somebody is walking.
  const onNarrateRef = useRef(onNarrate);
  onNarrateRef.current = onNarrate;

  useWakeLock(walking);

  // An arrival only counts once the guide can be heard. Before this, a stop reached
  // before the unlock tap was marked visited in silence and never told — the trigger
  // de-duplicates, so there was no second chance. Until the tap, the stop simply waits.
  const unlockedRef = useRef(false);
  unlockedRef.current = unlocked;
  const lastUsableFix = useRef(null);
  const arriveRef = useRef(() => {});
  arriveRef.current = (position) => {
    if (!unlockedRef.current || !position) return;
    const result = advanceTriggers(triggerState.current, position, { stops });
    triggerState.current = result.state;
    if (!result.speak) return;
    setVisitedIds((current) => [...new Set([...current, result.speak.id])]);
    onNarrateRef.current?.(result.speak);
    const text = trailStopText(result.speak);
    if (text) playerRef.current.say({ text, meta: { name: result.speak.place, checked: true } });
  };

  useEffect(() => {
    if (!walking || typeof navigator === "undefined" || !navigator.geolocation) return undefined;

    const watch = navigator.geolocation.watchPosition(
      (fix) => {
        const next = { coords: [fix.coords.latitude, fix.coords.longitude], accuracy: fix.coords.accuracy };
        // A fix too vague to place someone cannot support a trigger; say so rather
        // than silently doing nothing.
        if (!isUsableFix(next)) {
          setAccuracyWarning(true);
          return;
        }
        setAccuracyWarning(false);
        // Standing still produces a stream of jittering fixes that drain the battery
        // for no new information.
        if (!hasMovedEnough(lastFix.current, next.coords)) return;
        lastFix.current = next.coords;
        lastUsableFix.current = next;
        setPosition(next.coords);
        arriveRef.current(next);
      },
      () => setAccuracyWarning(true),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [walking, stops]);

  // `nextStop` returns a wrapper — the stop plus how far it is and whether we have
  // arrived — not the stop itself.
  const next = position ? nextStop(stops, position, { visitedIds }) : null;
  const banner = walkBanner(next);

  useEffect(() => { onNextStopChange?.(next?.stop?.id ?? null); }, [next?.stop?.id, onNextStopChange]);

  const state = playbackState({ walking, unlocked });

  // No trail is no longer no walk: listening needs nothing chosen first (#190).
  const hasTrail = Boolean(stops?.length);

  return (
    <div className="walk-controls" role="region" aria-label="Walk mode">
      {!walking && (
        <AmbientGuide onPlace={onAmbientPlace} onListeningChange={setListening} />
      )}
      {!hasTrail || listening ? null : !walking ? (
        <button className="walk-start" type="button" onClick={() => setWalking(true)}>
          <Footprints size={16} />
          <span>Walk this trail</span>
        </button>
      ) : (
        <div className="walk-active">
          <div className="walk-row">
            <strong>{banner.title}</strong>
            <button
              aria-label="Stop walking"
              className="walk-stop"
              onClick={() => {
                setWalking(false); setUnlocked(false); triggerState.current = {};
                lastUsableFix.current = null; lastFix.current = null; player.stop();
              }}
              type="button"
            >
              <Square size={14} />
            </button>
          </div>

          <small>{banner.detail}</small>

          {/* Asked for UP FRONT, not at the first stop: by then it is too late to
              explain why nothing is playing. */}
          {state === "needs-unlock" && (
            // The unlock has to happen inside this tap, or the first arrival is silent.
            <button className="walk-unlock" type="button" onClick={() => {
              player.unlock();
              setUnlocked(true);
              unlockedRef.current = true;
              // Somebody tapping at the first stop is standing still: no new fix will
              // come to trigger it, so the last one is checked now.
              arriveRef.current(lastUsableFix.current);
            }}>
              <Volume2 size={14} />
              <span>{UNLOCK_PROMPT}</span>
            </button>
          )}

          {state === "armed" && !player.current && (
            <small className="walk-armed"><Play size={12} /> Narration will start on arrival</small>
          )}

          {player.current && (
            <div className="walk-row">
              <small className="ambient-checked">
                {player.state === "preparing" ? "Getting ready… · " : ""}{player.current.name}
              </small>
              <button aria-label="Skip this telling" className="walk-stop" onClick={player.skip} type="button">
                <SkipForward size={14} />
              </button>
            </div>
          )}

          {accuracyWarning && (
            <small className="walk-warning">Waiting for a better GPS fix — nothing will play until then.</small>
          )}

          <small className="walk-safety">{ROAD_SAFETY_REMINDER}</small>
        </div>
      )}
    </div>
  );
}
