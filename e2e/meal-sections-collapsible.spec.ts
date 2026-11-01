import { test, expect, type Page } from '@playwright/test';
import { gotoApp, resetAppState, addNewProduct, productRow } from './helpers';

/**
 * Item 6 — the synthetic "Meal Plan" and "Suggested" sections on the list
 * builder must be collapsible, exactly like the normal store/section groups
 * (same chevron header + toggle mechanism). Tapping a section header hides its
 * rows; tapping again shows them.
 *
 * RED before the fix: the two synthetic headers were plain <div>s with no
 * collapse toggle, so there is no `meal-plan-collapse` / `suggested-collapse`
 * button and the rows can never be hidden.
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

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
									const lists = (all.result ?? []) as { status?: string; deleted_at?: string | null }[];
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

const gotoList = async (page: Page) => {
	await page.getByRole('link', { name: 'List' }).click();
	await expect(page.getByTestId('list-page')).toBeVisible();
};
const gotoMeals = async (page: Page) => {
	await page.getByRole('link', { name: 'Meals' }).click();
	await expect(page.getByTestId('meals-page')).toBeVisible();
};
const mealRow = (page: Page, name: string) =>
	page.locator(`[data-testid="meal-row"][data-meal-name="${name}"]`);

async function createMeal(page: Page, name: string) {
	await page.getByTestId('meal-name-input').fill(name);
	await page.getByTestId('add-meal').click();
	await expect(mealRow(page, name)).toBeVisible();
}

async function addProductToMeal(page: Page, mealName: string, productName: string) {
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
}

async function selectMeal(page: Page, mealName: string) {
	const toggle = mealRow(page, mealName).getByTestId('meal-select-toggle');
	await expect(toggle).toBeEnabled();
	if ((await toggle.getAttribute('data-selected')) !== 'true') await toggle.click();
	await expect(toggle).toHaveAttribute('data-selected', 'true');
}

test('Meal Plan and Suggested sections collapse/expand like normal sections', async ({ page }) => {
	await gotoApp(page);
	await waitForActiveList(page);

	// Seed a catalogue-only product (removed from the list) so Suggested renders.
	await addNewProduct(page, 'Eggs');
	const eggs = productRow(page, 'Eggs');
	await eggs.locator('button').first().click();
	await expect(eggs).toHaveAttribute('data-on-list', 'false');

	// Build + select a meal so both synthetic sections render.
	await gotoMeals(page);
	await createMeal(page, 'Breakfast');
	await addProductToMeal(page, 'Breakfast', 'Eggs');
	await selectMeal(page, 'Breakfast');

	await gotoList(page);
	const mealPlan = page.getByTestId('meal-plan-section');
	const suggested = page.getByTestId('suggested-section');
	await expect(mealPlan).toBeVisible();
	await expect(suggested).toBeVisible();

	const mealPlanRow = mealPlan.locator('[data-testid="meal-plan-row"][data-meal-name="Breakfast"]');
	const suggestedRow = suggested.locator('[data-testid="suggested-row"][data-product-name="Eggs"]');

	// Rows visible initially.
	await expect(mealPlanRow).toBeVisible();
	await expect(suggestedRow).toBeVisible();

	// Collapse Meal Plan → its rows hide, header stays.
	await mealPlan.getByTestId('meal-plan-collapse').click();
	await expect(mealPlanRow).toBeHidden();
	await expect(mealPlan).toBeVisible();
	// Suggested is unaffected.
	await expect(suggestedRow).toBeVisible();

	// Expand Meal Plan again → rows return.
	await mealPlan.getByTestId('meal-plan-collapse').click();
	await expect(mealPlanRow).toBeVisible();

	// Collapse Suggested → its rows hide, header stays.
	await suggested.getByTestId('suggested-collapse').click();
	await expect(suggestedRow).toBeHidden();
	await expect(suggested).toBeVisible();

	// Expand Suggested again → rows return.
	await suggested.getByTestId('suggested-collapse').click();
	await expect(suggestedRow).toBeVisible();
});
