"use client";

// Registers the walk's service worker, and says when the map is running from what it kept.
//
// Registration is deliberately late — `load`, not import time — because the worker's
// install fetches the shell, and a walk starts with the map, not with a cache warm-up.
//
// The badge is the other half of #161: "say what is cached and what is not, rather than
// failing silently". Offline, a map that keeps drawing looks identical to a map that is
// live, and the difference matters when the pin you want was never fetched.

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";

export default function OfflineReady() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        // A refused registration is not a reason to break the map — it is a reason to say
        // so once, in the console, and carry on online-only.
        console.warn("offline support unavailable", error?.message);
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    const online = () => setOffline(false);
    const lost = () => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", lost);

    return () => {
      window.removeEventListener("load", register);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", lost);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="offline-badge" role="status">
      <CloudOff size={14} aria-hidden="true" />
      <span>Offline — showing what this phone already loaded</span>
    </div>
  );
}
