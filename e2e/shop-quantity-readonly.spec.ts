import { test, expect } from '@playwright/test';
import { addNewProduct, gotoApp, productRow, quantityBadge, resetAppState } from './helpers';

/**
 * Item 9 — shop mode must NOT allow editing quantity.
 *
 * In shop mode the quantity is READ-ONLY text on the product card (no
 * QuantityControl touch surface / popover). The list-management view keeps the
 * editable QuantityControl.
 *
 * RED against current behavior: shop mode renders <QuantityControl> → a
 * `quantity-badge` is present and there is no `shop-quantity-text`.
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

test('shop mode shows read-only quantity text and exposes no quantity-adjust control', async ({
	page
}) => {
	await gotoApp(page);
	await addNewProduct(page, 'Milk');

	// Bump the quantity to 3 on the LIST page so the read-only text is meaningful.
	const badge = quantityBadge(page, 'Milk');
	await badge.click();
	const popover = productRow(page, 'Milk').getByTestId('quantity-popover');
	await popover.getByTestId('quantity-increment').click();
	await popover.getByTestId('quantity-increment').click();
	await expect(popover.getByTestId('quantity-value')).toHaveText('3');
	// Dismiss the popover.
	await page.getByTestId('quantity-scrim').click();

	// Enter shop mode.
	await page.getByRole('link', { name: 'Shop' }).click();
	await expect(page).toHaveURL(/\/shopping/);

	// The shop card shows the quantity as plain read-only text...
	const qtyText = page.getByTestId('shop-quantity-text');
	await expect(qtyText).toBeVisible();
	await expect(qtyText).toHaveText('×3');

	// ...and exposes NO editable quantity control (no badge, no popover trigger).
	await expect(page.getByTestId('quantity-badge')).toHaveCount(0);
	await expect(page.getByTestId('quantity-popover')).toHaveCount(0);
});

test('list view still exposes the editable quantity control (no regression)', async ({ page }) => {
	await gotoApp(page);
	await addNewProduct(page, 'Bread');

	// On the list page the editable badge is present and tappable.
	const badge = quantityBadge(page, 'Bread');
	await expect(badge).toBeVisible();
	await badge.click();
	await expect(productRow(page, 'Bread').getByTestId('quantity-popover')).toBeVisible();
});
