import { test, expect } from '@playwright/test';
import { gotoApp, resetAppState } from './helpers';

/**
 * Phase-2 E2E: SELECTING a meal for the active list on the Meals screen.
 *
 * Runs fully offline/local from a clean IndexedDB (resetAppState). The app seeds
 * an active list on load, which is the "week" selection is scoped to. This spec
 * covers selection STATE only — rendering the Suggested section on the shopping
 * list is Phase 3 and is NOT exercised here.
 *
 * Covered:
 *  - select a meal → the toggle reflects "Selected"
 *  - deselect → the toggle reverts to "Add"
 *  - the selection PERSISTS across a full reload (IndexedDB)
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

/**
 * Wait until the app has actually SEEDED an active list in IndexedDB. The List
 * page creates the active list lazily in its onMount (ensureActiveList), which
 * resolves after `gotoApp` already returns — so a fast client-side nav to Meals
 * could arrive before the list exists. Meal selection is scoped to that active
 * list, so we poll the DB until it's present to keep the spec deterministic
 * (this mirrors the real user flow of landing on the List tab first).
 */
async function waitForActiveList(page: import('@playwright/test').Page): Promise<void> {
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						new Promise<boolean>((resolve) => {
							const req = indexedDB.open('ShoppingListDB');
							req.onerror = () => resolve(false);
							req.onsuccess = () => {
								const dbh = req.result;
								if (!dbh.objectStoreNames.contains('lists')) {
									dbh.close();
									return resolve(false);
								}
								const tx = dbh.transaction('lists', 'readonly');
								const all = tx.objectStore('lists').getAll();
								all.onsuccess = () => {
									const lists = (all.result ?? []) as {
										status?: string;
										deleted_at?: string | null;
									}[];
									dbh.close();
									resolve(lists.some((l) => l.status === 'ACTIVE' && !l.deleted_at));
								};
								all.onerror = () => {
									dbh.close();
									resolve(false);
								};
							};
						})
				),
			{ timeout: 10_000 }
		)
		.toBe(true);
}

async function gotoMeals(page: import('@playwright/test').Page): Promise<void> {
	await page.getByRole('link', { name: 'Meals' }).click();
	await expect(page.getByTestId('meals-page')).toBeVisible();
}

async function createMeal(page: import('@playwright/test').Page, name: string): Promise<void> {
	await page.getByTestId('meal-name-input').fill(name);
	await page.getByTestId('add-meal').click();
	await expect(page.locator(`[data-testid="meal-row"][data-meal-name="${name}"]`)).toBeVisible();
}

function mealRow(page: import('@playwright/test').Page, name: string) {
	return page.locator(`[data-testid="meal-row"][data-meal-name="${name}"]`);
}

test('select and deselect a meal for the active list; the toggle reflects state', async ({
	page
}) => {
	await gotoApp(page);
	await waitForActiveList(page);
	await gotoMeals(page);
	await createMeal(page, 'Breakfast');

	const row = mealRow(page, 'Breakfast');
	const toggle = row.getByTestId('meal-select-toggle');

	// With an active list seeded, the toggle is enabled and starts unselected.
	await expect(toggle).toBeEnabled();
	await expect(toggle).toHaveAttribute('data-selected', 'false');
	await expect(toggle).toContainText('Add');

	// Select → reflects "Selected".
	await toggle.click();
	await expect(toggle).toHaveAttribute('data-selected', 'true');
	await expect(toggle).toContainText('Selected');

	// Deselect → reverts to "Add".
	await toggle.click();
	await expect(toggle).toHaveAttribute('data-selected', 'false');
	await expect(toggle).toContainText('Add');
});

test('a selection persists across reload (IndexedDB)', async ({ page }) => {
	await gotoApp(page);
	await waitForActiveList(page);
	await gotoMeals(page);
	await createMeal(page, 'Dinner');

	const toggle = mealRow(page, 'Dinner').getByTestId('meal-select-toggle');
	await toggle.click();
	await expect(toggle).toHaveAttribute('data-selected', 'true');

	// Full reload — the MealSelection row must re-hydrate from IndexedDB and the
	// toggle must come back as "Selected" for the still-active list.
	await page.reload();
	await gotoApp(page);
	await waitForActiveList(page);
	await gotoMeals(page);

	const toggleAfter = mealRow(page, 'Dinner').getByTestId('meal-select-toggle');
	await expect(toggleAfter).toHaveAttribute('data-selected', 'true');
	await expect(toggleAfter).toContainText('Selected');
});
