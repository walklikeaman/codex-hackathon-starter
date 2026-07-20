---
description: Sync wiki/ pages and docs after code changes — find stale references, update them, verify no contradictions remain. Run after any code, config, or API change.
---

Start the 'Docs Sync After Edits' loop. Goal: all wiki/ pages and docs that reference changed code/config are updated and verified. Max iterations: 3. Between iterations run: `git diff main...HEAD --name-only`. Exit when: all affected docs are updated and no contradictions exist between code and wiki.

Step 1: Review the diff — list every changed public API, config option, workflow step, or behaviour. Cross-reference with `wiki/index.md` to find pages that mention the changed items.

Step 2: Open each stale wiki page. Update facts, remove outdated claims, add new information. Follow the wiki conventions (YAML frontmatter, `updated:` date, cross-links).

Step 3: Verify — re-read the updated pages against the actual code/config. Confirm no contradiction exists. If `wiki/log.md` does not yet have an entry for this change, append one (per framework §4 auto-logging rule).

Step 4: Self-pace. After each pass, check whether any doc still references the old behaviour. Continue only if stale references remain.

**Guardrail rules:**
- Never edit files in `Context/` — those are immutable raw sources.
- Do not duplicate content across pages — link instead.
- Never create empty entity/concept pages — only create on first ingest that mentions them.
- `wiki/log.md` entries go at the TOP, newest-first.
