import { test, expect, type Page } from '@playwright/test';
import { gotoApp, resetAppState, addNewProduct, productRow } from './helpers';

/**
 * Items 4 + 7 — the meals page reuses the SHARED ProductSearchCreate component
 * (the list page's search/filter/create-zone UX), parameterised by entity type:
 *  - Meals CRUD: filter existing meals, and when the query matches none show a
 *    "Create" ZONE (replacing the old "Add" button). Selecting an existing meal
 *    expands it.
 *  - In-meal product picker: filter products; selecting a product adds it AND
 *    CLEARS the search input (Item 4).
 * The list page keeps its identical behaviour (guarded by the existing smoke /
 * suggested specs plus a clear-on-create assertion here).
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

const gotoMeals = async (page: Page) => {
	await page.getByRole('link', { name: 'Meals' }).click();
	await expect(page.getByTestId('meals-page')).toBeVisible();
};
const mealRow = (page: Page, name: string) =>
	page.locator(`[data-testid="meal-row"][data-meal-name="${name}"]`);

// ---------------------------------------------------------------------------
// Item 4 — the SMALLEST red case first: the in-meal product picker clears the
// search input on select.
// ---------------------------------------------------------------------------
test('meal product picker clears the search input after selecting a product (Item 4)', async ({
	page
}) => {
	await gotoApp(page);
	// Seed two catalogue products.
	await addNewProduct(page, 'Carrots');
	await addNewProduct(page, 'Celery');

	await gotoMeals(page);
	// Create a meal via the shared search's create zone.
	await page.getByTestId('meal-name-input').fill('Soup');
	await page.getByTestId('add-meal').click();
	await expect(mealRow(page, 'Soup')).toBeVisible();

	// Open the product picker for the meal (creation auto-expands it; only tap
	// the toggle if the products area isn't already open).
	const row = mealRow(page, 'Soup');
	if (!(await row.getByTestId('meal-products').isVisible().catch(() => false))) {
		await row.getByTestId('meal-toggle').click();
	}
	await expect(row.getByTestId('meal-products')).toBeVisible();
	await row.getByTestId('meal-add-product').click();

	const picker = page.getByRole('dialog');
	await expect(picker).toBeVisible();
	const search = picker.getByTestId('meal-product-search');
	await search.fill('Car');
	await picker
		.locator('[data-testid="meal-product-option"][data-product-name="Carrots"]')
		.click();

	// Item 4: the input must be cleared after selecting.
	await expect(search).toHaveValue('');
});

// ---------------------------------------------------------------------------
// Item 7 — meals CRUD create ZONE + filter + select-expands.
// ---------------------------------------------------------------------------
test('meals CRUD: create zone appears only when no match, and creates a meal', async ({ page }) => {
	await gotoApp(page);
	await gotoMeals(page);

	const search = page.getByTestId('meal-name-input');
	const createZone = page.getByTestId('add-meal');

	// Empty query → no create zone.
	await expect(createZone).toHaveCount(0);

	// Typing a brand-new name → create zone appears.
	await search.fill('Breakfast');
	await expect(createZone).toBeVisible();
	await createZone.click();

	// The meal is created (and the input cleared).
	await expect(mealRow(page, 'Breakfast')).toBeVisible();
	await expect(search).toHaveValue('');
});

test('meals CRUD: typing an existing meal name hides the create zone and offers it as a result', async ({
	page
}) => {
	await gotoApp(page);
	await gotoMeals(page);

	// Create a meal.
	await page.getByTestId('meal-name-input').fill('Dinner');
	await page.getByTestId('add-meal').click();
	await expect(mealRow(page, 'Dinner')).toBeVisible();

	// Typing the exact existing name → NO create zone (exact match exists).
	const search = page.getByTestId('meal-name-input');
	await search.fill('Dinner');
	await expect(page.getByTestId('add-meal')).toHaveCount(0);

	// A selectable result for the existing meal is offered; selecting it expands
	// the meal and clears the search.
	await page.getByTestId('meal-search-result').first().click();
	await expect(search).toHaveValue('');
	await expect(mealRow(page, 'Dinner').getByTestId('meal-products')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Regression — the LIST page search/create still behaves.
// ---------------------------------------------------------------------------
test('list page search + create still works (no regression)', async ({ page }) => {
	await gotoApp(page);
	await addNewProduct(page, 'Apples');
	await expect(productRow(page, 'Apples')).toHaveAttribute('data-on-list', 'true');

	// Filtering narrows the list; clearing restores it.
	const search = page.getByTestId('search-input');
	await search.fill('zzz-no-match');
	await expect(page.getByTestId('add-new-product')).toBeVisible();
	await search.fill('');
	await expect(page.getByTestId('add-new-product')).toHaveCount(0);
});
