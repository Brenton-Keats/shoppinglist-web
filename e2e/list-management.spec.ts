import { test, expect, type Page } from '@playwright/test';
import { resetAppState, addNewProduct } from './helpers';

/**
 * E2E for list selection persistence, "New List", archive and delete, driven
 * through the real "Switch list" sheet. Runs offline from a clean IndexedDB.
 *
 *  - The selected list survives tab changes and reloads (regression: it used to
 *    jump to an arbitrary ACTIVE list).
 *  - "New List" only creates; it never archives the current list.
 *  - "Archive current" switches to another active list, and only creates a new
 *    one when none is left.
 *  - Lists can be deleted (with confirmation); deleting the selected list moves
 *    the selection.
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

const sheet = (page: Page) => page.getByRole('dialog');
const rows = (page: Page) => sheet(page).getByTestId('list-row');
const row = (page: Page, name: string) =>
	sheet(page).locator(`[data-testid="list-row"][data-list-name="${name}"]`);
const headerTitle = (page: Page) => page.getByRole('heading', { level: 1 });

async function openSheet(page: Page): Promise<void> {
	// Retry the click: right after a (re)load the SSR'd button can be visible
	// before hydration attaches its handler, which swallows the first click.
	await expect(async () => {
		await page.getByRole('button', { name: 'Switch list' }).click();
		await expect(sheet(page)).toBeVisible({ timeout: 1_500 });
	}).toPass({ timeout: 10_000 });
}

/** Rename the currently selected list (sheet must be open). */
async function renameCurrent(page: Page, name: string): Promise<void> {
	const current = sheet(page).locator('[data-testid="list-row"][data-current="true"]');
	await current.getByRole('button', { name: /^Rename / }).click();
	const input = sheet(page).getByRole('textbox', { name: 'List name' });
	await input.fill(name);
	await input.press('Enter');
	await expect(row(page, name)).toBeVisible();
}

/** Select a list by name via the sheet (opens it if needed); closes the sheet. */
async function selectList(page: Page, name: string): Promise<void> {
	if (!(await sheet(page).isVisible())) await openSheet(page);
	await row(page, name).getByRole('button').first().click();
	await expect(sheet(page)).toBeHidden();
	await expect(headerTitle(page)).toHaveText(name);
}

/** Create "Alpha" (selected first) and "Beta"; leaves Beta selected, sheet closed. */
async function seedAlphaAndBeta(page: Page): Promise<void> {
	await openSheet(page);
	await renameCurrent(page, 'Alpha');
	await sheet(page).getByRole('button', { name: /new list/i }).click();
	await expect(sheet(page)).toBeHidden();
	await openSheet(page);
	await renameCurrent(page, 'Beta');
	await selectList(page, 'Beta');
}

// Both lists are ACTIVE, and the old "first ACTIVE list" fallback depends on
// random IDs. Checking EACH list as the selection guarantees one iteration
// differs from that fallback, so the regression is caught deterministically.
for (const target of ['Alpha', 'Beta']) {
	test(`selected list (${target}) persists across tab changes and reload`, async ({ page }) => {
		await seedAlphaAndBeta(page);
		await selectList(page, target);
		await addNewProduct(page, 'Milk');

		await page.getByRole('link', { name: 'Meals' }).click();
		await expect(page.getByTestId('meals-page')).toBeVisible();
		await page.getByRole('link', { name: 'List' }).click();
		await expect(page.getByTestId('list-page')).toBeVisible();
		await expect(headerTitle(page)).toHaveText(target);

		// Shop mode must show the SELECTED list (it has 1 item, the other none).
		await page.getByRole('link', { name: 'Shop' }).click();
		await expect(page.getByText('0/1 done')).toBeVisible();
		await page.getByRole('button', { name: 'Exit shopping mode' }).click();
		await expect(page.getByTestId('list-page')).toBeVisible();
		await expect(headerTitle(page)).toHaveText(target);

		await page.reload();
		await expect(page.getByTestId('list-page')).toBeVisible();
		await expect(headerTitle(page)).toHaveText(target);
	});
}

test('New List creates a list without archiving the current one', async ({ page }) => {
	await openSheet(page);
	await renameCurrent(page, 'Alpha');
	await selectList(page, 'Alpha'); // closes the sheet

	// Give Alpha an item: the old behaviour archived non-empty lists on New List.
	await addNewProduct(page, 'Milk');

	await openSheet(page);
	await sheet(page).getByRole('button', { name: /new list/i }).click();
	await expect(sheet(page)).toBeHidden();

	await openSheet(page);
	await expect(rows(page)).toHaveCount(2);
	await expect(row(page, 'Alpha')).toHaveAttribute('data-status', 'ACTIVE');
	await expect(row(page, 'Alpha')).not.toContainText('archived');
});

test('Archive current switches to another active list without creating a new one', async ({
	page
}) => {
	await seedAlphaAndBeta(page);
	await selectList(page, 'Alpha');
	await addNewProduct(page, 'Milk');

	await openSheet(page);
	await sheet(page).getByRole('button', { name: 'Archive current' }).click();
	await expect(sheet(page)).toBeHidden();
	await expect(headerTitle(page)).toHaveText('Beta');

	await openSheet(page);
	await expect(rows(page)).toHaveCount(2);
	await expect(row(page, 'Alpha')).toHaveAttribute('data-status', 'ARCHIVED');
	await expect(row(page, 'Beta')).toHaveAttribute('data-status', 'ACTIVE');
});

test('Archive current creates a new list only when no other active list exists', async ({
	page
}) => {
	await addNewProduct(page, 'Milk');

	await openSheet(page);
	await expect(rows(page)).toHaveCount(1);
	await sheet(page).getByRole('button', { name: 'Archive current' }).click();
	await expect(sheet(page)).toBeHidden();

	await openSheet(page);
	await expect(rows(page)).toHaveCount(2);
	await expect(
		sheet(page).locator('[data-testid="list-row"][data-status="ARCHIVED"]')
	).toHaveCount(1);
	await expect(
		sheet(page).locator('[data-testid="list-row"][data-current="true"]')
	).toHaveAttribute('data-status', 'ACTIVE');
});

test('Archive current does nothing for an empty list', async ({ page }) => {
	await openSheet(page);
	await sheet(page).getByRole('button', { name: 'Archive current' }).click();
	await expect(sheet(page)).toBeHidden();

	await openSheet(page);
	await expect(rows(page)).toHaveCount(1);
	await expect(rows(page).first()).toHaveAttribute('data-status', 'ACTIVE');
});

test('deleting a non-selected list requires confirmation and keeps the selection', async ({
	page
}) => {
	await seedAlphaAndBeta(page); // Beta selected
	await openSheet(page);

	// Cancel first: nothing is deleted.
	await row(page, 'Alpha').getByRole('button', { name: 'Delete Alpha' }).click();
	await row(page, 'Alpha').getByRole('button', { name: 'Cancel delete' }).click();
	await expect(rows(page)).toHaveCount(2);

	// Confirm: Alpha disappears, Beta stays selected.
	await row(page, 'Alpha').getByRole('button', { name: 'Delete Alpha' }).click();
	await row(page, 'Alpha').getByRole('button', { name: 'Confirm delete Alpha' }).click();
	await expect(row(page, 'Alpha')).toHaveCount(0);
	await expect(rows(page)).toHaveCount(1);
	await expect(row(page, 'Beta')).toHaveAttribute('data-current', 'true');

	// The deletion persists across a reload.
	await page.reload();
	await expect(page.getByTestId('list-page')).toBeVisible();
	await openSheet(page);
	await expect(rows(page)).toHaveCount(1);
	await expect(row(page, 'Alpha')).toHaveCount(0);
});

test('deleting the selected list moves the selection to another list', async ({ page }) => {
	await seedAlphaAndBeta(page); // Beta selected
	await openSheet(page);

	await row(page, 'Beta').getByRole('button', { name: 'Delete Beta' }).click();
	await row(page, 'Beta').getByRole('button', { name: 'Confirm delete Beta' }).click();

	await expect(row(page, 'Beta')).toHaveCount(0);
	await expect(row(page, 'Alpha')).toHaveAttribute('data-current', 'true');
	await selectList(page, 'Alpha');
});

test('deleting the only list leaves a fresh selected list', async ({ page }) => {
	await openSheet(page);
	await renameCurrent(page, 'Solo');

	await row(page, 'Solo').getByRole('button', { name: 'Delete Solo' }).click();
	await row(page, 'Solo').getByRole('button', { name: 'Confirm delete Solo' }).click();

	await expect(row(page, 'Solo')).toHaveCount(0);
	await expect(rows(page)).toHaveCount(1);
	await expect(rows(page).first()).toHaveAttribute('data-current', 'true');
});
