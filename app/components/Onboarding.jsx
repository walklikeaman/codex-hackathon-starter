"use client";

// The first run (#15): four short screens, then a deck of works to swipe.
//
// Every answer has a button as well as a swipe and an arrow key — a swipe nobody can see
// is not an interface. "Show my map" is there from the first card: the deck is an offer,
// not a gate, and leaving early keeps what was already chosen.

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bookmark, Check, Heart, Undo2, X } from "lucide-react";

import { CHOICE, CHOICES, choiceForSwipe, INTRO, orderDeck, remainingCards } from "../lib/onboarding.mjs";

const ICONS = { [CHOICE.skip]: X, [CHOICE.saved]: Bookmark, [CHOICE.known]: Check, [CHOICE.like]: Heart };
const KIND = { film: "Film", series: "Series", book: "Book" };

export default function Onboarding({ state, center = null, startAt = "intro", onDecide, onUndo, onFinish }) {
  const [step, setStep] = useState(startAt === "deck" ? INTRO.length : 0);
  const [cards, setCards] = useState(null);
  const [failed, setFailed] = useState(false);
  const [drag, setDrag] = useState(null);
  const origin = useRef(null);
  const inDeck = step >= INTRO.length;

  useEffect(() => {
    if (!inDeck || cards) return undefined;
    const controller = new AbortController();
    // Dealt for where the map is: a deck of the world's hits would fill "Only my films"
    // with stories that have nothing in this city.
    const query = center ? `?lat=${center[0].toFixed(4)}&lng=${center[1].toFixed(4)}` : "";
    fetch(`/api/deck${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body) => setCards(orderDeck(body.cards ?? [])))
      .catch((error) => { if (error?.name !== "AbortError") setFailed(true); });
    return () => controller.abort();
  }, [inDeck, cards]);

  const left = cards ? remainingCards(cards, state) : [];
  const card = left[0] ?? null;
  const picked = Object.values(state.decisions).filter((decision) => decision.choice !== CHOICE.skip).length;

  function answer(choice) {
    if (card) onDecide(card, choice);
    setDrag(null);
  }

  useEffect(() => {
    if (!inDeck) return undefined;
    const onKey = (event) => {
      const choice = CHOICES.find((entry) => entry.key === event.key);
      if (choice && card) { event.preventDefault(); answer(choice.id); }
      if (event.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!inDeck) {
    const screen = INTRO[step];
    return (
      <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-panel">
          <p className="eyebrow">{step + 1} of {INTRO.length}</p>
          <h2 id="onboarding-title">{screen.title}</h2>
          <p className="onboarding-text">{screen.text}</p>
          <div className="onboarding-dots" aria-hidden="true">
            {INTRO.map((entry, index) => <span key={entry.id} className={index === step ? "is-on" : ""} />)}
          </div>
          <div className="onboarding-actions">
            <button type="button" className="ghost-button" onClick={() => onFinish({ skipped: true })}>Skip</button>
            {step > 0 && (
              <button type="button" className="ghost-button" onClick={() => setStep(step - 1)} aria-label="Back">
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
            )}
            <button type="button" className="wide-button" onClick={() => setStep(step + 1)}>
              {step === INTRO.length - 1 ? "Pick what you like" : "Next"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const dx = drag?.dx ?? 0;
  const dy = drag?.dy ?? 0;
  const leaning = choiceForSwipe(dx, dy, 40);

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-panel is-deck">
        <header className="onboarding-deck-head">
          <h2 id="onboarding-title">What do you like?</h2>
          <p className="section-note">
            Swipe, use the buttons or the arrow keys. What you like, know or save goes into your library and fills the map.
          </p>
        </header>

        <div className="deck-stage">
          {failed && <p className="section-empty">The deck could not be loaded. You can pick films later from the map.</p>}
          {!failed && !cards && <p className="section-empty">Dealing the deck…</p>}
          {cards && !card && <p className="section-empty">That is the whole deck. Your map is ready.</p>}
          {card && (
            <article
              key={card.id}
              className={`deck-card${leaning ? ` is-${leaning}` : ""}`}
              style={{ transform: `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)` }}
              onPointerDown={(event) => { origin.current = [event.clientX, event.clientY]; event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => { if (origin.current) setDrag({ dx: event.clientX - origin.current[0], dy: event.clientY - origin.current[1] }); }}
              onPointerUp={() => { const choice = choiceForSwipe(dx, dy); origin.current = null; if (choice) answer(choice); else setDrag(null); }}
              onPointerCancel={() => { origin.current = null; setDrag(null); }}
            >
              {card.poster ? <img src={card.poster} alt="" draggable={false} /> : <div className="deck-card-blank" aria-hidden="true">{card.title.slice(0, 1)}</div>}
              <div className="deck-card-text">
                <strong>{card.title}</strong>
                <span>{[
                  KIND[card.kind] ?? card.kind,
                  card.year,
                  card.nearby > 0
                    ? `${card.nearby} ${card.nearby === 1 ? "place" : "places"} nearby`
                    : `${card.places} ${card.places === 1 ? "place" : "places"} elsewhere`,
                ].filter(Boolean).join(" · ")}</span>
              </div>
              {leaning && <span className="deck-card-stamp">{CHOICES.find((choice) => choice.id === leaning).label}</span>}
            </article>
          )}
        </div>

        <div className="deck-buttons">
          {CHOICES.map(({ id, label }) => {
            const Icon = ICONS[id];
            return (
              <button key={id} type="button" className={`deck-button is-${id}`} disabled={!card} onClick={() => answer(id)}>
                <Icon size={20} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="onboarding-actions">
          <button type="button" className="ghost-button" onClick={onUndo} disabled={!Object.keys(state.decisions).length} aria-label="Take back the last answer">
            <Undo2 size={18} aria-hidden="true" />
          </button>
          <span className="section-note">{cards ? `${cards.length - left.length} of ${cards.length} · ${picked} picked` : ""}</span>
          <button type="button" className="wide-button" onClick={() => onFinish()}>Show my map</button>
        </div>
      </div>
    </div>
  );
}
