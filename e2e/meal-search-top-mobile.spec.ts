import { test, expect, type Page } from '@playwright/test';
import { gotoApp, resetAppState, addNewProduct } from './helpers';

/**
 * Item 5 (CONDITIONAL, mobile-only) — on a touch/mobile device the in-meal
 * product-search input should sit near the TOP of the screen so results stay
 * visible above the soft keyboard. On desktop the picker keeps its normal
 * bottom-sheet layout (unchanged).
 *
 * Scoped purely with CSS `@media (pointer: coarse)` — no JS, no desktop impact:
 *  - coarse pointer (mobile) → the picker sheet anchors to the TOP of the
 *    viewport (items-start), putting the search input in the upper portion.
 *  - fine pointer (desktop) → the sheet stays bottom-anchored (items-end).
 */

const gotoMeals = async (page: Page) => {
	await page.getByRole('link', { name: 'Meals' }).click();
	await expect(page.getByTestId('meals-page')).toBeVisible();
};
const mealRow = (page: Page, name: string) =>
	page.locator(`[data-testid="meal-row"][data-meal-name="${name}"]`);

async function openPicker(page: Page): Promise<void> {
	await addNewProduct(page, 'Carrots');
	await gotoMeals(page);
	await page.getByTestId('meal-name-input').fill('Soup');
	await page.getByTestId('add-meal').click();
	await expect(mealRow(page, 'Soup')).toBeVisible();
	const row = mealRow(page, 'Soup');
	if (!(await row.getByTestId('meal-products').isVisible().catch(() => false))) {
		await row.getByTestId('meal-toggle').click();
	}
	await row.getByTestId('meal-add-product').click();
	await expect(page.getByRole('dialog')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

test('mobile: picker search input sits in the top half of the viewport', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile-chrome', 'mobile-only assertion');
	await gotoApp(page);
	await openPicker(page);

	const search = page.getByTestId('meal-product-search');
	await expect(search).toBeVisible();
	const viewport = page.viewportSize()!;
	const box = (await search.boundingBox())!;
	// Input is in the upper portion of the screen (above where a keyboard sits).
	expect(box.y).toBeLessThan(viewport.height / 2);
});

test('desktop: picker keeps its bottom-sheet layout (input in the lower half)', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name !== 'chromium', 'desktop-only assertion');
	await gotoApp(page);
	await openPicker(page);

	const search = page.getByTestId('meal-product-search');
	await expect(search).toBeVisible();
	const viewport = page.viewportSize()!;
	const box = (await search.boundingBox())!;
	// On desktop the sheet stays bottom-anchored, so the input is in the lower
	// portion of the viewport (unchanged behaviour).
	expect(box.y).toBeGreaterThan(viewport.height / 2);
});
