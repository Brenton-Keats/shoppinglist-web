import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for shoppinglist-web.
 *
 * This harness is ADDITIVE to the existing Vitest unit suite:
 *   - Vitest owns `src/tests/**` (see vitest.config.ts `include`).
 *   - Playwright owns `e2e/**` (via `testDir` below).
 * The two never overlap, so `npm test` runs only Vitest and
 * `npm run test:e2e` runs only Playwright.
 *
 * The app is an offline-first PWA backed by IndexedDB (Dexie). These E2E tests
 * run fully LOCAL against the dev server and do NOT require the real AWS sync
 * backend or any secrets in `.env`. The sync engine's failures are caught and
 * logged (never thrown), so a missing/failed sync does not break a local flow.
 * See e2e/README.md for details.
 *
 * The dev server is served at the ROOT path (SvelteKit `base` is '' outside a
 * production build), which keeps `baseURL` simple. The port is pinned to 4173
 * to stay clear of a developer's default `vite dev` on 5173.
 */

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: './e2e',
	/* Output artifacts (gitignored — see .gitignore). Kept distinct from the
	   unrelated `.playwright-mcp/` directory used for MCP logs. */
	outputDir: './test-results',
	/* Run spec files in parallel; within a file tests run in order. */
	fullyParallel: true,
	/* Fail the build on CI if test.only was left in the source. */
	forbidOnly: !!process.env.CI,
	/* Retry only on CI (local runs fail fast). */
	retries: process.env.CI ? 2 : 0,
	/* Opt out of parallel workers on CI for stability. */
	workers: process.env.CI ? 1 : undefined,
	reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
	timeout: 30_000,
	expect: { timeout: 10_000 },
	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		},
		{
			/* Mobile viewport — this is a mobile-first PWA. */
			name: 'mobile-chrome',
			use: { ...devices['Pixel 7'] }
		}
	],
	/* Build-free, production-like enough for UI verification: the dev server
	   renders and hydrates the full app. Reused if already running locally. */
	webServer: {
		command: `npm run dev -- --port ${PORT} --strictPort`,
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
