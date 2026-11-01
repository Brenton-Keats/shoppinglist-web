import { expect, type Page } from '@playwright/test';

/**
 * Shared E2E helpers for the shoppinglist-web smoke suite.
 *
 * These helpers keep each spec deterministic and independent by starting from a
 * clean IndexedDB state, and by funnelling the common "add a product" flow
 * through one place so selector changes only need updating once.
 */

/**
 * Navigate to the app root and wait for the main list UI to render.
 *
 * The app seeds an active list and hydrates on mount; we wait for the list page
 * container and the search box, which are the stable entry points to every
 * flow. Sync is offline-first and its failures are swallowed, so no network is
 * required for this to settle.
 */
export async function gotoApp(page: Page): Promise<void> {
	await page.goto('/');
	await expect(page.getByTestId('list-page')).toBeVisible();
	await expect(page.getByTestId('search-input')).toBeVisible();
}

/**
 * Clear all IndexedDB databases for the origin, then reload so the app
 * re-seeds a fresh active list. Call this at the start of each test to guarantee
 * isolation from any state a previous test (or a reused dev server) left behind.
 */
export async function resetAppState(page: Page): Promise<void> {
	// First navigation so an origin exists to clear storage against.
	await page.goto('/');
	await page.evaluate(async () => {
		// Delete every IndexedDB database for this origin.
		const anyIndexedDB = indexedDB as IDBFactory & {
			databases?: () => Promise<{ name?: string }[]>;
		};
		if (typeof anyIndexedDB.databases === 'function') {
			const dbs = await anyIndexedDB.databases();
			await Promise.all(
				dbs.map(
					(d) =>
						new Promise<void>((resolve) => {
							if (!d.name) return resolve();
							const req = indexedDB.deleteDatabase(d.name);
							req.onsuccess = req.onerror = req.onblocked = () => resolve();
						})
				)
			);
		}
		// Also clear web storage so preferences/sync metadata start clean.
		try {
			localStorage.clear();
			sessionStorage.clear();
		} catch {
			/* storage may be unavailable; ignore */
		}
	});
	// Reload into a guaranteed-fresh state.
	await gotoApp(page);
}

/**
 * Add a brand-new product (one that does not yet exist in the catalogue) via the
 * search box. The app creates the product, adds it to the active list, and opens
 * the product edit sheet; we dismiss that sheet so the row is interactable.
 */
export async function addNewProduct(page: Page, name: string): Promise<void> {
	const search = page.getByTestId('search-input');
	await search.click();
	await search.fill(name);
	// The "New" row appears only when the query matches no existing product.
	await page.getByTestId('add-new-product').click();

	// Adding a new product auto-opens the product edit sheet (a modal dialog).
	// Wait for it to appear, then dismiss it. The dialog closes on an Escape
	// keydown, but the handler lives on the dialog element, so we focus a field
	// inside it first and let the event bubble up.
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Name' }).press('Escape');
	await expect(dialog).toBeHidden();

	await expect(productRow(page, name)).toBeVisible();
}

/** Locator for a product row by its visible name. */
export function productRow(page: Page, name: string) {
	return page.locator(`[data-testid="product-row"][data-product-name="${name}"]`);
}

/** Locator for the quantity badge within a given product's row. */
export function quantityBadge(page: Page, name: string) {
	return productRow(page, name).getByTestId('quantity-badge');
}
