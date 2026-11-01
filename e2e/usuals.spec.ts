import { test, expect, type Page } from '@playwright/test';
import { gotoApp, resetAppState, addNewProduct, productRow } from './helpers';

/**
 * E2E for "THE USUALS" + the independent Meal Plan visibility flag.
 *
 * Runs fully offline/local from a clean IndexedDB. Covers, end-to-end through
 * the real UI:
 *  - Marking a meal as usual on the Meals screen MOVES it below the divider.
 *  - Creating/activating a NEW list auto-selects the usual so its products
 *    appear in Suggested WITHOUT manually selecting any meal.
 *  - A usual with in_meal_plan=false does NOT appear in the Meal Plan section.
 *  - Setting a normal selected meal's in_meal_plan=false removes it from Meal
 *    Plan while its products STILL appear in Suggested (independence).
 *  - Opting a usual OUT for the current list via its select toggle drops its
 *    products from Suggested and the opt-out SURVIVES a reload.
 *  - A usual product already on the list is excluded from Suggested (curation).
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

/** Wait until the app has SEEDED an active list in IndexedDB. */
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

/** Add an existing product to a meal via the picker and set its quantity. */
async function addProductToMeal(
	page: Page,
	mealName: string,
	productName: string,
	quantity: number
): Promise<void> {
	const row = mealRow(page, mealName);
	if (!(await row.getByTestId('meal-products').isVisible().catch(() => false))) {
		await row.getByTestId('meal-toggle').click();
		await expect(row.getByTestId('meal-products')).toBeVisible();
	}
	await row.getByTestId('meal-add-product').click();

	const picker = page.getByRole('dialog');
	await expect(picker).toBeVisible();
	await picker
		.locator(`[data-testid="meal-product-option"][data-product-name="${productName}"]`)
		.click();
	await picker.getByRole('button', { name: 'Close' }).click();
	await expect(picker).toBeHidden();

	const mpRow = row.locator(
		`[data-testid="meal-product-row"][data-product-name="${productName}"]`
	);
	await expect(mpRow).toBeVisible();
	for (let q = 1; q < quantity; q++) {
		await mpRow.getByTestId('quantity-badge').click();
		await mpRow.getByTestId('quantity-increment').click();
		await page.getByTestId('quantity-scrim').click();
	}
}

/** Remove a seeded product from the active list so it is catalogue-only. */
async function removeFromList(page: Page, name: string): Promise<void> {
	const row = productRow(page, name);
	await row.locator('button').first().click();
	await expect(row).toHaveAttribute('data-on-list', 'false');
}

const suggestedSection = (page: Page) => page.getByTestId('suggested-section');
const mealPlanSection = (page: Page) => page.getByTestId('meal-plan-section');
const suggestedRow = (page: Page, name: string) =>
	page.locator(`[data-testid="suggested-row"][data-product-name="${name}"]`);

test('mark usual → moves below divider → new list auto-selects it → Suggested without manual selection; not in Meal Plan when hidden', async ({
	page
}) => {
	await gotoApp(page);
	await waitForActiveList(page);

	// Catalogue-only products (not on the list) so they can appear in Suggested.
	await addNewProduct(page, 'Oats');
	await addNewProduct(page, 'Coffee');
	await removeFromList(page, 'Oats');
	await removeFromList(page, 'Coffee');

	// Build a meal with products, then mark it as a usual.
	await gotoMeals(page);
	await createMeal(page, 'Staples');
	await addProductToMeal(page, 'Staples', 'Oats', 2);
	await addProductToMeal(page, 'Staples', 'Coffee', 1);

	// Collapse the expanded meal so the toggle row is clean, then mark as usual.
	const staples = mealRow(page, 'Staples');
	await staples.getByTestId('meal-usual-toggle').click();
	await expect(staples).toHaveAttribute('data-usual', 'true');

	// Hide it from the Meal Plan (independent flag) — this is the usuals pattern.
	await staples.getByTestId('meal-plan-toggle').click();
	await expect(staples).toHaveAttribute('data-in-meal-plan', 'false');

	// It now appears BELOW the divider (the usuals group).
	await expect(page.getByTestId('usuals-divider')).toBeVisible();
	const order = await page.getByTestId('meals-page').evaluate((root) => {
		const nodes = Array.from(root.querySelectorAll('[data-testid]'));
		const divider = nodes.findIndex((n) => n.getAttribute('data-testid') === 'usuals-divider');
		const staplesIdx = nodes.findIndex(
			(n) =>
				n.getAttribute('data-testid') === 'meal-row' &&
				n.getAttribute('data-meal-name') === 'Staples'
		);
		return { divider, staplesIdx };
	});
	expect(order.divider).toBeGreaterThanOrEqual(0);
	expect(order.staplesIdx).toBeGreaterThan(order.divider);

	// --- Create a NEW list. The usual must be auto-selected, so its products
	//     appear in Suggested WITHOUT us selecting any meal manually. ---
	await gotoList(page);
	await page.getByRole('button', { name: 'Switch list' }).click();
	const listSheet = page.getByRole('dialog');
	await expect(listSheet).toBeVisible();
	await listSheet.getByRole('button', { name: /new list/i }).click();
	await expect(listSheet).toBeHidden();

	// Suggested shows the usual's products (auto-selected on the fresh list).
	await expect(suggestedSection(page)).toBeVisible();
	await expect(suggestedRow(page, 'Oats')).toHaveAttribute('data-quantity', '2');
	await expect(suggestedRow(page, 'Coffee')).toHaveAttribute('data-quantity', '1');

	// The usual has in_meal_plan=false → it does NOT appear in the Meal Plan
	// section. (With only this hidden meal selected, the Meal Plan section is
	// empty and therefore hidden entirely.)
	await expect(
		mealPlanSection(page).locator('[data-testid="meal-plan-row"][data-meal-name="Staples"]')
	).toHaveCount(0);
});

test('in_meal_plan=false removes a selected meal from Meal Plan but its products STILL appear in Suggested', async ({
	page
}) => {
	await gotoApp(page);
	await waitForActiveList(page);

	await addNewProduct(page, 'Rice');
	await removeFromList(page, 'Rice');

	await gotoMeals(page);
	await createMeal(page, 'Dinner');
	await addProductToMeal(page, 'Dinner', 'Rice', 4);

	// Select it normally (in_meal_plan defaults true) → appears in Meal Plan.
	const dinner = mealRow(page, 'Dinner');
	await dinner.getByTestId('meal-select-toggle').click();
	await expect(dinner.getByTestId('meal-select-toggle')).toHaveAttribute('data-selected', 'true');

	await gotoList(page);
	await expect(
		mealPlanSection(page).locator('[data-testid="meal-plan-row"][data-meal-name="Dinner"]')
	).toBeVisible();
	await expect(suggestedRow(page, 'Rice')).toHaveAttribute('data-quantity', '4');

	// Hide it from the Meal Plan (in_meal_plan=false). It must LEAVE Meal Plan...
	await gotoMeals(page);
	await dinner.getByTestId('meal-plan-toggle').click();
	await expect(dinner).toHaveAttribute('data-in-meal-plan', 'false');

	await gotoList(page);
	await expect(
		mealPlanSection(page).locator('[data-testid="meal-plan-row"][data-meal-name="Dinner"]')
	).toHaveCount(0);
	// ...but its products STILL appear in Suggested (independence).
	await expect(suggestedRow(page, 'Rice')).toHaveAttribute('data-quantity', '4');
});

test('opt a usual OUT for the current list → products drop from Suggested → opt-out survives reload', async ({
	page
}) => {
	await gotoApp(page);
	await waitForActiveList(page);

	await addNewProduct(page, 'Butter');
	await removeFromList(page, 'Butter');

	await gotoMeals(page);
	await createMeal(page, 'Usual Meal');
	await addProductToMeal(page, 'Usual Meal', 'Butter', 1);
	const usual = mealRow(page, 'Usual Meal');
	// Marking usual auto-selects it for the ACTIVE list (side effect of setUsual).
	await usual.getByTestId('meal-usual-toggle').click();
	await expect(usual).toHaveAttribute('data-usual', 'true');
	await expect(usual.getByTestId('meal-select-toggle')).toHaveAttribute('data-selected', 'true');

	// Its product is suggested on the current list.
	await gotoList(page);
	await expect(suggestedRow(page, 'Butter')).toBeVisible();

	// Opt it OUT for THIS list via the Meals-screen select toggle (kept for
	// usuals, defaulted on). Suggested must drop its product.
	await gotoMeals(page);
	await usual.getByTestId('meal-select-toggle').click();
	await expect(usual.getByTestId('meal-select-toggle')).toHaveAttribute('data-selected', 'false');

	await gotoList(page);
	await expect(suggestedRow(page, 'Butter')).toHaveCount(0);

	// The opt-out SURVIVES a reload (a deliberate per-list skip is not resurrected).
	await page.reload();
	await gotoApp(page);
	await waitForActiveList(page);
	await expect(suggestedRow(page, 'Butter')).toHaveCount(0);
	// And the Meals screen still shows it deselected.
	await gotoMeals(page);
	await expect(
		mealRow(page, 'Usual Meal').getByTestId('meal-select-toggle')
	).toHaveAttribute('data-selected', 'false');
});

test('a usual product already on the list is excluded from Suggested (curation)', async ({
	page
}) => {
	await gotoApp(page);
	await waitForActiveList(page);

	// 'Milk' will be the usual's product AND will be curated onto the list.
	await addNewProduct(page, 'Milk');
	await addNewProduct(page, 'Bread');
	await removeFromList(page, 'Bread'); // Bread stays catalogue-only; Milk stays ON the list.

	await gotoMeals(page);
	await createMeal(page, 'Usual Meal');
	await addProductToMeal(page, 'Usual Meal', 'Milk', 2);
	await addProductToMeal(page, 'Usual Meal', 'Bread', 1);
	const usual = mealRow(page, 'Usual Meal');
	await usual.getByTestId('meal-usual-toggle').click();
	await expect(usual).toHaveAttribute('data-usual', 'true');

	await gotoList(page);
	// Milk is already on the list → excluded from Suggested (curation). Bread is
	// not on the list → it is suggested.
	await expect(suggestedRow(page, 'Milk')).toHaveCount(0);
	await expect(suggestedRow(page, 'Bread')).toHaveAttribute('data-quantity', '1');
});
