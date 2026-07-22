---
description: A fast ~30-minute visual polish of the demo — so it looks intentional, not "thrown together." Polish, not redesign.
---

# /ui-polish — make the demo look intentional

Judges also grade how it looks. In 30 minutes a rough screen can be made
presentable without a rewrite. This is polish on top of a working demo path, not a redesign.

## Pass (in descending order of payoff)

1. **One accent color + neutrals.** Pick one meaningful accent that fits the project's theme,
   everything else — restrained grays/background. No rainbow.
2. **Rhythm and breathing room.** A single spacing scale (8/16/24), headings larger and with air,
   body text ~65 characters per line. Don't cram everything against the edges.
3. **States.** Empty state (no data yet — a clear placeholder, not a blank screen),
   loading (spinner/skeleton), error (what happened and what to do). Demos often break
   precisely on the empty/loading state.
4. **One typography.** One font (system is fine), 3–4 sizes, a readable line height.
5. **Mobile and dark theme** — if the demo will be shown from a phone: `max-width` on images,
   flex/grid with `gap`, the page body doesn't scroll sideways.
6. **Remove the junk** — placeholders, "lorem," test buttons, console errors.

## Rules

- Don't touch the demo path's logic — only the outer layer. Broke the flow — roll it back.
- Real content, not "lorem." There should be no empty screens on stage.
- Check in the browser after each step, not "by eye in the code."

Deliver a short list of what you changed, and one thing that would've been worth improving but you didn't get to.
