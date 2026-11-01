# End-to-end tests (Playwright)

Real-browser E2E tests for shoppinglist-web. These render and drive the actual
app in Chromium, complementing the Vitest unit suite (`src/tests/**`, run via
`npm test`). The two suites never overlap: Vitest only picks up
`src/tests/**/*.test.ts`, Playwright only picks up `e2e/**`.

## What it covers

`e2e/smoke.spec.ts` is a small but real smoke suite:

1. **App loads** — the root route renders the main list UI and the mobile
   bottom navigation.
2. **Add an item** — the add-product flow adds a new item to the active list.
3. **Quantity** — add an item (defaults to a muted `×1`), open the compact
   −/value/+ popover, increment (badge becomes full-emphasis at 2+), decrement
   (floors at 1 — never 0, never removes the item), and confirm the value
   **persists across a page reload** (IndexedDB).

Each test starts from a clean IndexedDB state (`resetAppState` in
`e2e/helpers.ts`) so tests are deterministic and independent.

## Offline / local-only assumption

This is an offline-first PWA backed by IndexedDB (Dexie) with a sync layer to a
remote AWS API. **The E2E tests run fully local and do NOT require the backend
or any secrets.**

- No `.env` is needed. The sync config is read lazily via `$env/dynamic/public`,
  and the sync engine catches and logs its failures (it never throws into the
  app), so a missing or failing sync does not break a local flow. You may see a
  "Sync status: error" indicator during a run — that is expected and harmless.
- Tests exercise local IndexedDB behaviour only.

If you *want* to point the app at a backend while running E2E locally, create a
`.env` from `.env.example` — but it is not required and not recommended for CI.

## Running the tests

From the repo root (not `lambda/`):

```bash
# One-time: install browser binaries (Chromium only, matching the config)
npx playwright install chromium

# Run headless (both chromium + mobile viewport projects)
npm run test:e2e

# Interactive UI mode (watch / time-travel)
npm run test:e2e:ui

# Run unit + E2E suites sequentially
npm run test:all
```

The Playwright config (`playwright.config.ts`) starts the app itself via a
`webServer` entry (`npm run dev` on a pinned port `4173`) and waits for it
before running, so you do not need to start a server manually. An
already-running server on that port is reused outside CI.

## Projects (viewports)

- `chromium` — desktop Chrome.
- `mobile-chrome` — Pixel 7 viewport (this is a mobile-first PWA).

## Node version

The project requires Node `>=24`. Use that (e.g. `nvm use 24`) for both
`npm install` and the Playwright run.

## Artifacts

Test output is written to (and gitignored):

- `test-results/` — traces, screenshots, failure context
- `playwright-report/` — the HTML report (`npx playwright show-report`)

These are intentionally distinct from the unrelated `.playwright-mcp/` directory
(MCP logs) already present in the repo.

## Stable selectors

The specs prefer role/text selectors and a few minimal `data-testid` hooks added
to existing components for stability (`list-page`, `search-input`,
`add-new-product`, `product-row`, and the `quantity-*` hooks on
`QuantityControl`). These attributes do not change any UI behaviour.
