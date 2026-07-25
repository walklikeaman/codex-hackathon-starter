"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

const DEBOUNCE_MS = 140;

// Split a title around the matched characters so the typed part can be emphasised —
// the thing that makes an IMDb-style dropdown feel like it is answering *you*.
function TitleWithMatch({ title, match }) {
  if (!match) return <>{title}</>;
  return (
    <>
      {title.slice(0, match.start)}
      <mark>{title.slice(match.start, match.end)}</mark>
      {title.slice(match.end)}
    </>
  );
}

// Type-ahead over the grounded graph. Suggestions come from the persistent graph, so
// they arrive at index speed; submitting the form still runs the live Wikidata search
// for titles we have not grounded yet, which is why this wraps rather than replaces it.
export default function WorkSearchBox({ value, onChange, onPick, onSubmit, children }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const requestRef = useRef(null);
  const timerRef = useRef(null);
  const boxRef = useRef(null);
  const listId = useId();

  const load = useCallback(async (query) => {
    requestRef.current?.abort();
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`search responded ${response.status}`);
      const body = await response.json();
      setSuggestions(Array.isArray(body.suggestions) ? body.suggestions : []);
      setActive(-1);
    } catch (error) {
      if (error?.name === "AbortError") return; // superseded by a later keystroke
      setSuggestions([]);
    }
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => load(value), DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [value, load]);

  useEffect(() => () => requestRef.current?.abort(), []);

  // A dropdown that survives a click elsewhere is a dropdown in the way.
  useEffect(() => {
    if (!open) return undefined;
    const onDocumentPointerDown = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, [open]);

  const choose = (suggestion) => {
    setOpen(false);
    setActive(-1);
    onPick?.(suggestion);
  };

  function handleKeyDown(event) {
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); // otherwise the caret jumps inside the input
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        const next = current + step;
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault(); // pick the highlighted row instead of submitting
      choose(suggestions[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <div className="work-search-box" ref={boxRef}>
      <form
        className="work-search"
        onSubmit={(event) => {
          setOpen(false);
          onSubmit?.(event);
        }}
        role="search"
      >
        {children}
        <input
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-controls={showList ? listId : undefined}
          aria-expanded={showList}
          aria-label="Film, series, or book title"
          autoComplete="off"
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Film, series, or book"
          role="combobox"
          type="text"
          value={value}
        />
      </form>

      {showList && (
        <ul className="search-suggestions" id={listId} role="listbox">
          {suggestions.map((suggestion, index) => (
            <li
              aria-selected={index === active}
              className={`search-suggestion${index === active ? " is-active" : ""}`}
              id={`${listId}-${index}`}
              key={suggestion.work_id}
              onMouseEnter={() => setActive(index)}
              role="option"
            >
              <button onClick={() => choose(suggestion)} type="button">
                {suggestion.poster_thumb_url ? (
                  <img alt="" loading="lazy" src={suggestion.poster_thumb_url} />
                ) : (
                  <span className="suggestion-poster-empty" aria-hidden="true" />
                )}
                <span className="suggestion-text">
                  <span className="suggestion-title">
                    <TitleWithMatch title={suggestion.title} match={suggestion.match} />
                  </span>
                  <small>
                    {suggestion.kind_label}
                    {suggestion.year ? ` · ${suggestion.year}` : ""}
                    {suggestion.place_count > 0 ? ` · ${suggestion.place_count} places` : ""}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
