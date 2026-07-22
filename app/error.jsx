"use client";

// Root error boundary: turns any uncaught render/commit error (e.g. a Leaflet
// flyTo throw on invalid state) into a recoverable card instead of a blank SPA.
export default function Error({ error, reset }) {
  return (
    <main className="app-error">
      <div className="app-error-card" role="alert">
        <h1>Something went wrong</h1>
        <p>The map hit an unexpected error. You can try again without losing your session.</p>
        {error?.digest && <p className="app-error-digest">Reference: {error.digest}</p>}
        <button type="button" onClick={() => reset()}>Try again</button>
      </div>
    </main>
  );
}
