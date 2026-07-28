"use client";

// The film profile: poster, ratings that link back to their source, every place we
// hold for this work, and frames from the film.
//
// The layout carries the product's central claim. Places we actually FOUND come
// first, badged with how precisely we know them. A studio sits below with an
// explicit "depicts somewhere else" — its pin is a real coordinate, but it is not
// the street the scene portrays, and blurring those two would be the one thing this
// project refuses to do.
//
// The gallery is captioned for what it actually holds. TMDB's gallery mixes real
// production stills with promotional key art, and no metadata field separates them —
// tested on Skyfall, whose gun-barrel art carries the same "textless" marking as a
// genuine still. So it does not promise "frames", and it says outright that nothing
// here is matched to a place: that claim needs the vision check, not a gallery.

import { useEffect, useState } from "react";
import { ExternalLink, MapPin, X } from "lucide-react";

const ROLE_HINT = {
  studio: "The pin is the studio itself — the scene it portrays is somewhere else.",
  narrative: "Set here in the story. Not a filming location.",
  fictional: "A fictional place, never given a coordinate.",
  unknown: "We could not confirm what kind of place this is.",
};

export default function WorkProfile({ film, onClose, onSelectPlace }) {
  const [state, setState] = useState({ status: "loading", data: null });

  useEffect(() => {
    if (!film?.tmdbId && !film?.workId) return undefined;
    const controller = new AbortController();
    setState({ status: "loading", data: null });

    (async () => {
      try {
        // A graph work is addressed by our uuid; a live chip only has a TMDB id.
        const query = film.workId
          ? `id=${encodeURIComponent(film.workId)}`
          : `${film.kind === "series" ? "series" : "film"}=${encodeURIComponent(film.tmdbId)}`;
        const response = await fetch(`/api/work?${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`profile responded ${response.status}`);
        setState({ status: "ready", data: await response.json() });
      } catch (error) {
        if (error?.name !== "AbortError") setState({ status: "error", data: null });
      }
    })();
    return () => controller.abort();
  }, [film?.tmdbId, film?.workId, film?.kind]);

  // Escape closes it, like the recreate dialog — a full-screen overlay with no
  // keyboard exit is a trap.
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const data = state.data;
  const places = data?.places ?? [];
  const found = places.filter((place) => place.role === "on_location");
  const elsewhere = places.filter((place) => place.role !== "on_location");

  return (
    <div className="recreate-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section aria-labelledby="work-profile-title" aria-modal="true" className="recreate-dialog work-profile" role="dialog">
        <header className="recreate-header">
          <div className="work-profile-head">
            {data?.work?.poster && (
              <img alt="" className="work-profile-poster" src={data.work.poster} />
            )}
            <div>
              <p className="eyebrow">{film.kind === "series" ? "Series" : "Film"}</p>
              <h2 id="work-profile-title">{data?.work?.title ?? film.title}</h2>
              {(data?.work?.year ?? film.year) && <span>{data?.work?.year ?? film.year}</span>}

              {data?.ratings?.length > 0 && (
                <ul className="work-profile-ratings">
                  {data.ratings.map((rating) => (
                    <li key={rating.source}>
                      {/* The score links to the page it was read from, so a reader can
                          check it rather than trust us. */}
                      <a href={rating.url ?? undefined} target="_blank" rel="noopener noreferrer">
                        <strong>{rating.display}</strong>
                        <small>{rating.source.replace(/_/g, " ")}</small>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button aria-label="Close film profile" autoFocus className="icon-button recreate-close"
            onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <div className="work-profile-body">
          {state.status === "loading" && <p className="work-profile-note">Loading the film…</p>}
          {state.status === "error" && <p className="work-profile-note">Could not load this film.</p>}

          {data?.links?.length > 0 && (
            <nav className="work-profile-links" aria-label="External sources">
              {data.links.map((link) => (
                <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.label} <ExternalLink size={12} />
                </a>
              ))}
            </nav>
          )}

          {state.status === "ready" && places.length === 0 && (
            <p className="work-profile-note">
              No mapped places for this film yet. Nothing is invented to fill the gap.
            </p>
          )}

          {found.length > 0 && (
            <section className="work-profile-section">
              <h3>Filmed on location <span className="work-profile-count">{found.length}</span></h3>
              <ul className="work-profile-places">
                {found.map((place) => (
                  <li key={place.id}>
                    <button type="button" onClick={() => onSelectPlace?.(place)}>
                      <MapPin size={14} />
                      <span>
                        <strong>{place.name}</strong>
                        <small>{[place.city, place.country].filter(Boolean).join(", ")}</small>
                      </span>
                      <em className={`precision-badge precision-${place.precision.split(" ")[0].toLowerCase()}`}>
                        {place.precision}
                      </em>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {elsewhere.length > 0 && (
            <section className="work-profile-section">
              <h3>Studios and story settings <span className="work-profile-count">{elsewhere.length}</span></h3>
              <ul className="work-profile-places is-secondary">
                {elsewhere.map((place) => (
                  <li key={place.id}>
                    <button type="button" onClick={() => onSelectPlace?.(place)}>
                      <MapPin size={14} />
                      <span>
                        <strong>{place.name}</strong>
                        <small>{ROLE_HINT[place.role] ?? place.role_label}</small>
                      </span>
                      {place.depicts_elsewhere && <em className="precision-badge is-studio">Studio</em>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Checked and found to hold nothing but promotional art. Rendering nothing
              at all would read as a bug; saying so is the same courtesy the places
              list gets when a film has none. */}
          {state.status === "ready" && data?.stills_verified && data.stills.length === 0 && (
            <section className="work-profile-section">
              <h3>Images from the film</h3>
              <p className="work-profile-note">
                This title&apos;s gallery holds only promotional art — posters, key art and
                posed press shots. No frames from the film to show.
              </p>
            </section>
          )}

          {data?.stills?.length > 0 && (
            <section className="work-profile-section">
              <h3>Images from the film <span className="work-profile-count">{data.stills.length}</span></h3>
              {/* Stated, not implied: none of these is a claim about a place. */}
              <p className="work-profile-note">{data.stills_note}</p>
              <ul className="work-profile-stills">
                {data.stills.map((still) => (
                  <li key={still.url}>
                    <a href={still.full ?? still.url} target="_blank" rel="noopener noreferrer">
                      <img alt="" loading="lazy" src={still.url} />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="work-profile-credit">Images via TMDB.</p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
