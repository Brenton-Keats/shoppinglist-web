import { test, expect, type Page } from '@playwright/test';
import { gotoApp, resetAppState, addNewProduct, productRow } from './helpers';

/**
 * Phase-3 E2E: the "Meal Plan" + "Suggested" sections on the MAIN list view,
 * and the full meal → select → suggested → tap-add → sum → exclude loop.
 *
 * Runs fully offline/local from a clean IndexedDB. The app seeds an active list
 * on load (the "week" selection is scoped to). We build everything through the
 * real UI: create products on the List screen, build meals on the Meals screen,
 * select them, then verify the synthetic sections on the List screen.
 *
 * Covered:
 *  - Suggested renders FIRST (above the normal product groups) with correct
 *    summed quantities; Meal Plan shows the selected meal.
 *  - Tap a Suggested row → the product is added to its normal section AND
 *    disappears from Suggested (curation rule, reactive recompute).
 *  - A second meal sharing a product → the Suggested quantity SUMS.
 *  - A product already on the list never appears in Suggested.
 *  - Deselecting a meal updates Suggested (and hides both sections when the plan
 *    is emptied).
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

/**
 * Wait until the app has actually SEEDED an active list in IndexedDB (created
 * lazily in the List page onMount). Meal selection is scoped to that list, so we
 * poll before navigating to Meals to keep the spec deterministic.
 */
async function waitForActiveList(page: Page): Promise<void> {
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

async function gotoList(page: Page): Promise<void> {
	await page.getByRole('link', { name: 'List' }).click();
	await expect(page.getByTestId('list-page')).toBeVisible();
}

async function gotoMeals(page: Page): Promise<void> {
	await page.getByRole('link', { name: 'Meals' }).click();
	await expect(page.getByTestId('meals-page')).toBeVisible();
}

function mealRow(page: Page, name: string) {
	return page.locator(`[data-testid="meal-row"][data-meal-name="${name}"]`);
}

async function createMeal(page: Page, name: string): Promise<void> {
	await page.getByTestId('meal-name-input').fill(name);
	await page.getByTestId('add-meal').click();
	await expect(mealRow(page, name)).toBeVisible();
}

/**
 * Add an existing product to a meal via the per-meal product picker, and set its
 * quantity by tapping the + control `quantity - 1` times (default is 1).
 */
async function addProductToMeal(
	page: Page,
	mealName: string,
	productName: string,
	quantity: number
): Promise<void> {
	const row = mealRow(page, mealName);
	// Expand the meal if its product area isn't open yet.
	if (!(await row.getByTestId('meal-products').isVisible().catch(() => false))) {
		await row.getByTestId('meal-toggle').click();
		await expect(row.getByTestId('meal-products')).toBeVisible();
	}
	await row.getByTestId('meal-add-product').click();

	const picker = page.getByRole('dialog');
	await expect(picker).toBeVisible();
	await picker.locator(`[data-testid="meal-product-option"][data-product-name="${productName}"]`).click();
	// Picker stays open for multi-add; close it.
	await picker.getByRole('button', { name: 'Close' }).click();
	await expect(picker).toBeHidden();

	// Set quantity on the meal-product row (default 1 → tap + to reach target).
	const mpRow = row.locator(
		`[data-testid="meal-product-row"][data-product-name="${productName}"]`
	);
	await expect(mpRow).toBeVisible();
	for (let q = 1; q < quantity; q++) {
		await mpRow.getByTestId('quantity-badge').click();
		await mpRow.getByTestId('quantity-increment').click();
		// Close the popover between increments by tapping the scrim.
		await page.getByTestId('quantity-scrim').click();
	}
}

async function selectMeal(page: Page, mealName: string): Promise<void> {
	const toggle = mealRow(page, mealName).getByTestId('meal-select-toggle');
	await expect(toggle).toBeEnabled();
	if ((await toggle.getAttribute('data-selected')) !== 'true') {
		await toggle.click();
	}
	await expect(toggle).toHaveAttribute('data-selected', 'true');
}

const suggestedSection = (page: Page) => page.getByTestId('suggested-section');
const mealPlanSection = (page: Page) => page.getByTestId('meal-plan-section');
const suggestedRow = (page: Page, name: string) =>
	page.locator(`[data-testid="suggested-row"][data-product-name="${name}"]`);

test('full loop: meal → select → Suggested renders first & sums → tap-add excludes → deselect hides', async ({
	page
}) => {
	await gotoApp(page);
	await waitForActiveList(page);

	// Seed products on the List screen (also adds them to the list, so remove the
	// two we want to appear in Suggested — they must NOT already be list items).
	await addNewProduct(page, 'Eggs');
	await addNewProduct(page, 'Milk');
	await addNewProduct(page, 'Flour');
	// Remove Eggs/Milk/Flour from the list so they are catalogue-only products.
	for (const name of ['Eggs', 'Milk', 'Flour']) {
		const row = productRow(page, name);
		// The row's first button is the toggle; clicking an on-list product removes it.
		await row.locator('button').first().click();
		await expect(row).toHaveAttribute('data-on-list', 'false');
	}

	// Build Breakfast = 2 Eggs + 1 Milk on the Meals screen.
	await gotoMeals(page);
	await createMeal(page, 'Breakfast');
	await addProductToMeal(page, 'Breakfast', 'Eggs', 2);
	await addProductToMeal(page, 'Breakfast', 'Milk', 1);
	await selectMeal(page, 'Breakfast');

	// --- Main list view: Suggested renders FIRST with summed quantities. ---
	await gotoList(page);
	await expect(mealPlanSection(page)).toBeVisible();
	await expect(mealPlanSection(page).locator('[data-testid="meal-plan-row"][data-meal-name="Breakfast"]')).toBeVisible();

	await expect(suggestedSection(page)).toBeVisible();
	await expect(suggestedRow(page, 'Eggs')).toHaveAttribute('data-quantity', '2');
	await expect(suggestedRow(page, 'Milk')).toHaveAttribute('data-quantity', '1');

	// Suggested must come BEFORE the first normal product group in the DOM.
	const listPage = page.getByTestId('list-page');
	const suggestedIndex = await listPage.evaluate((root) => {
		const nodes = Array.from(root.querySelectorAll('[data-testid]'));
		const s = nodes.findIndex((n) => n.getAttribute('data-testid') === 'suggested-section');
		const p = nodes.findIndex((n) => n.getAttribute('data-testid') === 'product-row');
		return { s, p };
	});
	expect(suggestedIndex.s).toBeGreaterThanOrEqual(0);
	expect(suggestedIndex.p).toBeGreaterThanOrEqual(0);
	expect(suggestedIndex.s).toBeLessThan(suggestedIndex.p);

	// --- Add a SECOND meal sharing Eggs → Suggested SUMS. ---
	await gotoMeals(page);
	await createMeal(page, 'Dinner');
	await addProductToMeal(page, 'Dinner', 'Eggs', 3);
	await selectMeal(page, 'Dinner');

	await gotoList(page);
	// Eggs: 2 (Breakfast) + 3 (Dinner) = 5. Milk unchanged at 1.
	await expect(suggestedRow(page, 'Eggs')).toHaveAttribute('data-quantity', '5');
	await expect(suggestedRow(page, 'Milk')).toHaveAttribute('data-quantity', '1');
	// Meal Plan now lists both meals.
	await expect(mealPlanSection(page).locator('[data-testid="meal-plan-row"][data-meal-name="Breakfast"]')).toBeVisible();
	await expect(mealPlanSection(page).locator('[data-testid="meal-plan-row"][data-meal-name="Dinner"]')).toBeVisible();

	// --- Tap-to-add Eggs from Suggested → added to its section with qty 5 AND
	//     disappears from Suggested (curation rule, reactive recompute). ---
	await suggestedRow(page, 'Eggs').click();
	await expect(suggestedRow(page, 'Eggs')).toHaveCount(0);
	// Eggs now appears as a normal on-list product row with quantity 5.
	const eggsProduct = productRow(page, 'Eggs');
	await expect(eggsProduct).toHaveAttribute('data-on-list', 'true');
	await expect(eggsProduct.getByTestId('quantity-badge')).toHaveAttribute('data-quantity', '5');
	// Milk is still suggested.
	await expect(suggestedRow(page, 'Milk')).toBeVisible();

	// --- A product already on the list never appears in Suggested. ---
	// Eggs (just added) is on the list and no longer in Suggested — asserted above.
	await expect(suggestedSection(page)).not.toContainText('Eggs');

	// --- Deselect Dinner → Suggested updates (Eggs already added/excluded; Milk
	//     remains from Breakfast). Meal Plan drops Dinner. ---
	await gotoMeals(page);
	const dinnerToggle = mealRow(page, 'Dinner').getByTestId('meal-select-toggle');
	await dinnerToggle.click();
	await expect(dinnerToggle).toHaveAttribute('data-selected', 'false');

	await gotoList(page);
	await expect(mealPlanSection(page).locator('[data-testid="meal-plan-row"][data-meal-name="Dinner"]')).toHaveCount(0);
	await expect(suggestedRow(page, 'Milk')).toBeVisible();

	// --- Deselect the last meal via the Meal Plan deselect affordance → BOTH
	//     sections hide entirely (empty-state choice). ---
	await mealPlanSection(page)
		.locator('[data-testid="meal-plan-row"][data-meal-name="Breakfast"]')
		.getByTestId('meal-plan-deselect')
		.click();
	await expect(mealPlanSection(page)).toHaveCount(0);
	await expect(suggestedSection(page)).toHaveCount(0);
});

test('no meals selected → neither Meal Plan nor Suggested renders', async ({ page }) => {
	await gotoApp(page);
	await waitForActiveList(page);
	// Fresh list, no meals selected.
	await expect(mealPlanSection(page)).toHaveCount(0);
	await expect(suggestedSection(page)).toHaveCount(0);
});
