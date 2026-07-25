"use client";

import { useEffect, useRef, useState } from "react";

import { lockAction, wakeLockSupported } from "../lib/walk-mode.mjs";

// Holds a screen Wake Lock while walk mode is on and the page is visible.
//
// The lifecycle rule that matters: the browser RELEASES the lock whenever the page is
// hidden, and does not restore it on return. Without re-acquiring on visibilitychange,
// walk mode dies after the first glance at another app — the exact failure it exists
// to prevent. When to acquire or release is decided in walk-mode.mjs so it can be
// tested without a browser; this hook only performs it.
export default function useWakeLock(walking) {
  const [held, setHeld] = useState(false);
  const [supported, setSupported] = useState(true);
  const sentinelRef = useRef(null);
  const stateRef = useRef({ walking: false, visible: true });

  useEffect(() => {
    if (typeof navigator === "undefined" || typeof document === "undefined") return undefined;

    const available = wakeLockSupported(navigator);
    setSupported(available);

    let cancelled = false;

    const release = async () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      setHeld(false);
      try {
        await sentinel?.release?.();
      } catch {
        // Already gone — releasing twice is not worth surfacing.
      }
    };

    const acquire = async () => {
      if (!available || sentinelRef.current) return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release?.();
          return;
        }
        sentinelRef.current = sentinel;
        setHeld(true);
        // The browser fires this when it drops the lock on its own.
        sentinel.addEventListener?.("release", () => {
          sentinelRef.current = null;
          setHeld(false);
        });
      } catch {
        // Denied (battery saver, no user gesture) — the tour still works, the screen
        // may just dim, so this is reported rather than thrown.
        setHeld(false);
      }
    };

    const sync = () => {
      const next = { walking: Boolean(walking), visible: !document.hidden };
      const action = lockAction(stateRef.current, next);
      stateRef.current = next;
      if (action === "acquire") acquire();
      if (action === "release") release();
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", sync);
      release();
    };
  }, [walking]);

  return { held, supported };
}
