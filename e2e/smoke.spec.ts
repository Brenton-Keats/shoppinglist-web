import { test, expect } from '@playwright/test';
import { addNewProduct, gotoApp, productRow, quantityBadge, resetAppState } from './helpers';

/**
 * Real-browser smoke suite for shoppinglist-web.
 *
 * Runs fully offline/local against the dev server (no AWS sync backend, no
 * secrets). Each test starts from a clean IndexedDB state so the tests are
 * deterministic and independent.
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

test('app loads: main list UI and bottom nav render', async ({ page }) => {
	await gotoApp(page);

	// The list page container and the search box are the stable entry points.
	await expect(page.getByTestId('list-page')).toBeVisible();
	await expect(page.getByTestId('search-input')).toBeVisible();

	// The mobile-first bottom navigation exposes its tabs by accessible label.
	await expect(page.getByRole('link', { name: 'List' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Shop' })).toBeVisible();
});

test('add an item: new product appears on the list', async ({ page }) => {
	await gotoApp(page);

	await addNewProduct(page, 'Bananas');

	// The row exists and is marked as on-list.
	const row = productRow(page, 'Bananas');
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute('data-on-list', 'true');

	// The list summary reflects one item.
	await expect(page.getByText(/1 item on list/)).toBeVisible();
});

test('quantity: defaults to 1 (muted), increments, floors at 1, and persists across reload', async ({
	page
}) => {
	await gotoApp(page);
	await addNewProduct(page, 'Milk');

	const badge = quantityBadge(page, 'Milk');

	// Default quantity is 1 and the badge is muted (faint ×1).
	await expect(badge).toHaveText('×1');
	await expect(badge).toHaveAttribute('data-quantity', '1');
	await expect(badge).toHaveAttribute('data-muted', 'true');

	// Tap the badge to open the compact −/value/+ popover.
	await badge.click();
	const popover = productRow(page, 'Milk').getByTestId('quantity-popover');
	await expect(popover).toBeVisible();

	// At quantity 1 the decrement control is a disabled no-op (never 0).
	await expect(popover.getByTestId('quantity-decrement')).toBeDisabled();
	await expect(popover.getByTestId('quantity-value')).toHaveText('1');

	// Press + twice → quantity 3, and the badge becomes full-emphasis (not muted).
	await popover.getByTestId('quantity-increment').click();
	await expect(popover.getByTestId('quantity-value')).toHaveText('2');
	await popover.getByTestId('quantity-increment').click();
	await expect(popover.getByTestId('quantity-value')).toHaveText('3');

	await expect(badge).toHaveText('×3');
	await expect(badge).toHaveAttribute('data-muted', 'false');

	// Press − once → floors toward 1; at 2 the decrement is enabled.
	await expect(popover.getByTestId('quantity-decrement')).toBeEnabled();
	await popover.getByTestId('quantity-decrement').click();
	await expect(popover.getByTestId('quantity-value')).toHaveText('2');

	// Press − again → 1, then decrement becomes a disabled no-op (floors at 1).
	await popover.getByTestId('quantity-decrement').click();
	await expect(popover.getByTestId('quantity-value')).toHaveText('1');
	await expect(popover.getByTestId('quantity-decrement')).toBeDisabled();

	// Bump back up to 2 so persistence is meaningful (not the default).
	await popover.getByTestId('quantity-increment').click();
	await expect(popover.getByTestId('quantity-value')).toHaveText('2');

	// The value must PERSIST across a page reload (IndexedDB), not reset to 1.
	await page.reload();
	await gotoApp(page);

	const badgeAfterReload = quantityBadge(page, 'Milk');
	await expect(badgeAfterReload).toHaveText('×2');
	await expect(badgeAfterReload).toHaveAttribute('data-quantity', '2');
	await expect(badgeAfterReload).toHaveAttribute('data-muted', 'false');
});
