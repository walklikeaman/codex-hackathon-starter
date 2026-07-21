# Testing Patterns

**Analysis Date:** 2026-07-21

## Test Framework

**Runner:**
- Not detected: `package.json` defines only `dev`, `build`, and `start`; no `test` script or test-runner dependency is declared.
- No Jest, Vitest, Node test runner, Cypress, or Playwright Test configuration exists beside `package.json`, `next.config.mjs`, or `vercel.json`.
- The `@playwright/test` text in `package-lock.json` is an optional peer of Next.js, not a declared root dependency or configured project runner.
- Playwright in `setup.sh` and `config/mcp.json` is an optional MCP browser driver for live verification, not a checked-in automated test suite.
- Config: Not detected; there is no `jest.config.*`, `vitest.config.*`, or `playwright.config.*` in the repository.

**Assertion Library:**
- Not detected: no assertion dependency is declared in `package.json`, and no `expect`, `assert`, `describe`, `it`, or `test` calls exist in tracked source files.

**Run Commands:**
```bash
npm install                    # Install package.json dependencies before JavaScript checks
npm run build                  # Configured production compile/build gate
bash -n setup.sh scaffold.sh   # Shell syntax check for both executable scripts
./setup.sh --check             # Informational local-tooling smoke check; installs nothing
npm run dev                    # Start the app for manual browser/demo-path verification
```

- `npm run build` is the only configured automated application-quality gate in `package.json`; it requires dependencies installed from `package-lock.json`.
- `./setup.sh --check` reports missing tooling but deliberately reaches `exit 0` after the report, so it is not a strict assertion that every optional tool exists; see `setup.sh`.
- No watch-mode test command exists in `package.json`.
- No coverage command exists in `package.json`.

## Test File Organization

**Location:**
- Not detected: there is no `tests/`, `test/`, or `__tests__/` directory, and no co-located `*.test.*` or `*.spec.*` files next to `app/layout.jsx`, `app/page.jsx`, `setup.sh`, `scaffold.sh`, or `docs/index.html`.
- Manual verification procedures live in `prompts/loop-demo.md`, `prompts/loop-lint.md`, `prompts/loop-debug.md`, and `prompts/loop-pr-review.md` rather than executable test files.
- Failed debugging attempts, not test results, are recorded in `.loops/reflexion.md`.

**Naming:**
- No automated test naming pattern is established because no test files exist under `app/` or at repository root.
- Do not assume `*.test.jsx` or `*.spec.jsx` until a runner and matching `package.json` script are introduced together; the first test harness must establish one consistent convention.

**Structure:**
```text
Not detected

app/
├── layout.jsx        # implementation only; no paired test
└── page.jsx          # implementation only; no paired test

setup.sh              # executable setup logic; no shell test suite
scaffold.sh           # executable scaffold logic; no shell test suite
docs/index.html       # static guide behavior; no browser spec
```

## Test Structure

**Suite Organization:**
```text
No automated suite pattern exists in the repository.
Verification is organized as operator loops in prompts/loop-*.md.
```

**Patterns:**
- Select the check that the project actually exposes, run it, fix the reported cause with a minimal diff, and rerun until exit zero; this loop is defined in `prompts/loop-lint.md`.
- Verify the locked demo path by driving the real page or endpoint, stopping at the first broken step, fixing it, and replaying the full flow; this loop is defined in `prompts/loop-demo.md` and required by `AGENTS.md`.
- Reproduce a failure before changing code and record each failed approach before trying a different hypothesis; this loop is defined in `prompts/loop-debug.md` and stores attempts in `.loops/reflexion.md`.
- Mark a specification item complete only after its behavior is observable and verified; this pattern is defined in `prompts/loop-spec-ship.md`.
- Review new code for missing tests during the completeness pass even though no harness exists; this check is defined in `prompts/loop-pr-review.md`.
- Run syntax/build checks before shipping, then reread the real result; `AGENTS.md`, `prompts/autopilot.md`, and `prompts/ship.md` make verification part of the delivery loop.

## Mocking

**Framework:** Not detected in `package.json`, `package-lock.json`, or any source file under `app/`.

**Patterns:**
```text
No jest.mock, vi.mock, spy, stub, fake-timer, network-interception,
or dependency-injection test pattern exists in the repository.
```

**What to Mock:**
- No automated mocking policy is established in `app/`, because no test runner or test suite exists.
- For demo-path work, prefer real data flow; if a hardcoded value is needed to keep the demo landing, record the shortcut in `.loops/guardrails.md` as required by `prompts/loop-demo.md`.
- Treat `process.env.NEXT_PUBLIC_SUPABASE_URL` and `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment inputs in `app/page.jsx`; never hardcode credential-shaped test data, per `AGENTS.md` and `.loops/guardrails.md`.

**What NOT to Mock:**
- Do not replace the locked end-to-end demo path with code inspection or a simulated success; `AGENTS.md` and `prompts/loop-demo.md` require opening the result and exercising the path.
- Do not modify a failing test or its success criteria to force a pass; `prompts/loop-debug.md`, `prompts/loop-spec-ship.md`, and `prompts/loop-guardrails.md` explicitly prohibit gaming the check.
- Do not treat Playwright MCP configuration in `config/mcp.json` as evidence of passing browser tests; no Playwright spec or runner config is checked in.

## Fixtures and Factories

**Test Data:**
```text
Not detected. There are no fixture modules, factories, snapshots, seed files,
or test-only datasets in app/, tests/, or repository-root source files.
```

**Location:**
- Not detected: `Context/` is an immutable raw-source inbox described by `AGENTS.md`, not a test-fixture directory.
- Not detected: `wiki/` contains durable project knowledge described by `wiki/index.md`, not executable test data.
- Example seed-data ideas inside `docs/index.html` and `IDEAS.md` are project prompts, not implemented fixtures.

## Coverage

**Requirements:** None enforced in `package.json`; no coverage provider, threshold, report directory, or CI workflow is configured.

**View Coverage:**
```bash
# Not available: package.json has no coverage script and no test runner is configured.
```

- Do not report numeric coverage for `app/layout.jsx`, `app/page.jsx`, `setup.sh`, `scaffold.sh`, or `docs/index.html`; no instrumentation or report exists.
- The practical quality gate is build success plus real demo-path verification, as defined by `prompts/loop-lint.md` and `prompts/loop-demo.md`.

## Test Types

**Unit Tests:**
- Not used: no unit test files cover `Home` in `app/page.jsx`, `RootLayout` in `app/layout.jsx`, browser helpers in `docs/index.html`, or shell helpers in `setup.sh`.
- No component-rendering library is declared in `package.json`.

**Integration Tests:**
- Not used: no automated test exercises environment detection in `app/page.jsx`, MCP configuration in `config/mcp.json`, or setup/scaffold behavior in `setup.sh` and `scaffold.sh`.
- `./setup.sh --check` is an operational smoke command, not an integration suite, because it reports state without asserting all optional dependencies.

**E2E Tests:**
- No automated E2E specs are checked in for `app/page.jsx` or `docs/index.html`.
- Real browser verification is the required project pattern in `AGENTS.md` and `prompts/loop-demo.md`.
- Playwright can be connected as an optional MCP browser driver through `./setup.sh --playwright` in `setup.sh` or the definition in `config/mcp.json`; it has no version-pinned project dependency or test config.

**Build and Smoke Checks:**
- Run `npm run build` from `package.json` after dependencies are installed; this verifies Next.js compilation and production bundling but not behavioral assertions.
- Run `bash -n setup.sh scaffold.sh` for shell parse validation; both scripts return zero on the analysis date.
- Run `npm run dev`, open the rendered page from `app/page.jsx`, and confirm the environment-status branches visibly match the intended inputs, following `prompts/loop-demo.md`.
- Exercise the language toggle, persistence fallback, and copy-button success/failure states in `docs/index.html` when that static guide changes.

## Common Patterns

**Async Testing:**
```text
Not detected. The only checked-in asynchronous browser behavior is the
navigator.clipboard.writeText(...).then(...).catch(...) runtime flow in
docs/index.html; no test drives or awaits it.
```

**Error Testing:**
```text
Not detected. Error branches exist in setup.sh and docs/index.html, but no
automated assertions exercise unknown flags, missing prerequisites, blocked
localStorage, or clipboard rejection.
```

**Manual Demo Verification:**
```text
1. Restate the one locked path from AGENTS.md.
2. Run the application and perform each user action for real.
3. Capture the first failing step.
4. Apply the smallest root-cause fix.
5. Replay the complete path until it is green.
```

- This sequence is the canonical behavior-verification pattern in `prompts/loop-demo.md`.
- Keep the pass criterion observable: rendered UI, endpoint response, or completed browser action, as required by `AGENTS.md` and `prompts/loop-spec-ship.md`.

## Adding the First Automated Suite

- Introduce the runner dependency, its config, and `test`/watch/coverage scripts in `package.json` as one coherent change; no partial harness exists to extend.
- Choose one location and naming convention with the first suite, then apply it consistently around `app/`; no repository precedent exists today.
- Start with behavior that protects the locked demo path from `AGENTS.md`, especially the environment-status branches in `app/page.jsx` and any new interactive/API boundary.
- Keep browser automation distinct from the optional Playwright MCP transport in `config/mcp.json`; checked-in tests need an explicit runner, deterministic specs, and a documented command.
- Add CI only after the local command is deterministic; there is no `.github/workflows/` pipeline to inherit.
- Preserve the project rule that tests verify behavior and are not weakened to make a change pass, as stated in `prompts/loop-debug.md`, `prompts/loop-lint.md`, and `prompts/loop-spec-ship.md`.

## Analysis-Time Verification

- `npm run` lists only `dev`, `build`, and `start` from `package.json`; no test, lint, typecheck, watch, or coverage script is available.
- `node_modules/` is absent in the analyzed checkout, so `npm run build` reports `next: command not found` until `npm install` or `./scaffold.sh` installs dependencies from `package-lock.json`.
- `bash -n setup.sh scaffold.sh` exits zero, confirming both shell files parse successfully.
- No `tests/` directory or `*.test.*`/`*.spec.*` file is present beside the tracked implementation files.

---

*Testing analysis: 2026-07-21*
