import { test, expect } from '@playwright/test';
import { addNewProduct, gotoApp, resetAppState } from './helpers';

/**
 * Real-browser E2E for the Phase-1 Meals feature. Runs fully offline/local, each
 * test from a clean IndexedDB (via resetAppState). Covers: navigate to the Meals
 * tab, create a meal, add a product, adjust the product quantity (+ raises, −
 * floors at 1), remove the product, delete the meal, and persistence across a
 * reload.
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

/** Open the Meals tab from the bottom nav and wait for the page to render. */
async function gotoMeals(page: import('@playwright/test').Page): Promise<void> {
	await page.getByRole('link', { name: 'Meals' }).click();
	await expect(page.getByTestId('meals-page')).toBeVisible();
}

/** Create a meal via the add-meal input. */
async function createMeal(page: import('@playwright/test').Page, name: string): Promise<void> {
	await page.getByTestId('meal-name-input').fill(name);
	await page.getByTestId('add-meal').click();
	await expect(page.locator(`[data-testid="meal-row"][data-meal-name="${name}"]`)).toBeVisible();
}

function mealRow(page: import('@playwright/test').Page, name: string) {
	return page.locator(`[data-testid="meal-row"][data-meal-name="${name}"]`);
}

test('Meals tab is reachable and renders the meals page', async ({ page }) => {
	await gotoApp(page);
	await expect(page.getByRole('link', { name: 'Meals' })).toBeVisible();
	await gotoMeals(page);
	// Empty state shows before any meal exists.
	await expect(page.getByText('No meals yet')).toBeVisible();
});

test('create a meal, add a product, adjust quantity, remove product, delete meal', async ({
	page
}) => {
	await gotoApp(page);

	// Seed a product on the List screen (Phase 1 picks EXISTING products).
	await addNewProduct(page, 'Eggs');

	await gotoMeals(page);
	await createMeal(page, 'Breakfast');

	// Expanding the meal is automatic after creation; open the product picker.
	const row = mealRow(page, 'Breakfast');
	await row.getByTestId('meal-add-product').click();

	// Pick the existing product from the sheet.
	await page
		.locator(`[data-testid="meal-product-option"][data-product-name="Eggs"]`)
		.click();

	// Close the picker sheet (Escape via the search field so the handler bubbles).
	await page.getByTestId('meal-product-search').press('Escape');

	// The product row appears inside the meal with a quantity badge at ×1.
	const productRow = row.locator('[data-testid="meal-product-row"][data-product-name="Eggs"]');
	await expect(productRow).toBeVisible();
	const badge = productRow.getByTestId('quantity-badge');
	await expect(badge).toHaveText('×1');
	await expect(badge).toHaveAttribute('data-muted', 'true');

	// + raises the quantity; − floors at 1.
	await badge.click();
	const popover = productRow.getByTestId('quantity-popover');
	await expect(popover).toBeVisible();
	await expect(popover.getByTestId('quantity-decrement')).toBeDisabled();

	await popover.getByTestId('quantity-increment').click();
	await expect(popover.getByTestId('quantity-value')).toHaveText('2');
	await popover.getByTestId('quantity-increment').click();
	await expect(popover.getByTestId('quantity-value')).toHaveText('3');

	await popover.getByTestId('quantity-decrement').click();
	await expect(popover.getByTestId('quantity-value')).toHaveText('2');
	await popover.getByTestId('quantity-decrement').click();
	await expect(popover.getByTestId('quantity-value')).toHaveText('1');
	await expect(popover.getByTestId('quantity-decrement')).toBeDisabled();

	// Close the popover by clicking its dismiss scrim, then wait for it to go
	// away so it no longer intercepts the remove click.
	await productRow.getByTestId('quantity-scrim').click();
	await expect(popover).toBeHidden();

	// Remove the product from the meal.
	await productRow.getByTestId('meal-product-remove').click();
	await expect(productRow).toBeHidden();

	// Delete the meal (confirm in the dialog).
	await row.getByTestId('meal-delete').click();
	await page.getByTestId('meal-delete-confirm').click();
	await expect(mealRow(page, 'Breakfast')).toBeHidden();
	await expect(page.getByText('No meals yet')).toBeVisible();
});

test('a created meal persists across reload (IndexedDB)', async ({ page }) => {
	await gotoApp(page);
	await gotoMeals(page);
	await createMeal(page, 'Dinner');

	await page.reload();
	await gotoApp(page);
	await gotoMeals(page);

	await expect(mealRow(page, 'Dinner')).toBeVisible();
});
