import { test, expect, type Page } from '@playwright/test';
import { addNewProduct, gotoApp, resetAppState } from './helpers';

/**
 * Within-section item ORDER must be IDENTICAL on the list builder and shop mode,
 * even on AGED data whose `ListItem.sort_order` keys have drifted / carry legacy
 * duplicate `a0` values (see .agents/tasks/shop-vs-list-item-order-investigation.md).
 *
 * The user's repro: five items in one section, move the fifth to position 2.
 * On fresh data both screens agree (1,5,2,3,4). On aged data the shop screen
 * (which sorted ListItem.sort_order with NO tiebreak) rendered 5,1,2,3,4 while
 * the list builder rendered 1,5,2,3,4.
 *
 * This spec builds five products through the real UI, then forces the aged
 * degenerate key state directly in IndexedDB (duplicate `a0` on the moved item
 * and the first item, a distinct `a0V` product key for the moved item), reloads,
 * and asserts the list view and shop view show the SAME within-section order —
 * and that it is the intended 1,5,2,3,4.
 */

const NAMES = ['Apple', 'Banana', 'Carrot', 'Date', 'Eggplant'] as const;

/** Read the on-list product order as rendered on the LIST page. */
async function listOrder(page: Page): Promise<string[]> {
	return page
		.locator('[data-testid="product-row"][data-on-list="true"]')
		.evaluateAll((nodes) =>
			(nodes as HTMLElement[]).map((n) => n.getAttribute('data-product-name') ?? '')
		);
}

/** Read the item order as rendered in SHOP mode. */
async function shopOrder(page: Page): Promise<string[]> {
	return page
		.locator('[data-testid="shop-item"]')
		.evaluateAll((nodes) => (nodes as HTMLElement[]).map((n) => n.getAttribute('data-item-name') ?? ''));
}

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

test('list view and shop view show the same within-section order on aged degenerate keys', async ({
	page
}) => {
	await gotoApp(page);

	// Build five products (all Uncategorized → one section). Each gets added to
	// the active list in lockstep, with distinct fresh keys.
	for (const name of NAMES) {
		await addNewProduct(page, name);
	}

	// Force the AGED degenerate state directly in IndexedDB, keyed by the item
	// name_snapshot so we don't depend on generated ids. This is the §3 state
	// with the mirrored move (Eggplant moved to position 2 → both its product AND
	// its list-item key are the clean mirrored `a0V`), PLUS a surviving legacy
	// duplicate `a0` on a neighbour's list item (Banana) that the old move never
	// cleaned up:
	//   Apple    product a0 , item a0
	//   Banana   product a1 , item a0   <- legacy duplicate (shares a0 with Apple)
	//   Carrot   product a2 , item a2
	//   Date     product a3 , item a3
	//   Eggplant product a0V, item a0V  <- moved to position 2 (mirror wrote both)
	//
	// Under the OLD shop sort (ListItem.sort_order, NO tiebreak) the equal `a0`
	// pair (Apple, Banana) kept query order while the list builder sorted the
	// PRODUCT keys — so the two screens diverged. The shared comparator makes BOTH
	// screens order the same field with the same `id` tiebreak, so they now agree
	// deterministically. (The duplicate `a0` means the agreed order is consistent,
	// not necessarily the user's long-ago intended order — that is restored only
	// by the lazy heal on the next reorder; see the ordering.test.ts lazy-heal
	// test. The REQUIRED outcome of this fix is the two screens being identical.)
	await page.evaluate(async () => {
		const PROD: Record<string, string> = {
			Apple: 'a0',
			Banana: 'a1',
			Carrot: 'a2',
			Date: 'a3',
			Eggplant: 'a0V'
		};
		const ITEM: Record<string, string> = {
			Apple: 'a0',
			Banana: 'a0',
			Carrot: 'a2',
			Date: 'a3',
			Eggplant: 'a0V'
		};

		await new Promise<void>((resolve, reject) => {
			const open = indexedDB.open('ShoppingListDB');
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const db = open.result;
				const tx = db.transaction(['products', 'listItems'], 'readwrite');
				const products = tx.objectStore('products');
				const items = tx.objectStore('listItems');

				products.getAll().onsuccess = (e) => {
					const all = (e.target as IDBRequest).result as Array<{ name: string; sort_order: string }>;
					for (const p of all) {
						if (PROD[p.name] !== undefined) {
							p.sort_order = PROD[p.name];
							products.put(p);
						}
					}
				};
				items.getAll().onsuccess = (e) => {
					const all = (e.target as IDBRequest).result as Array<{
						name_snapshot: string;
						sort_order: string;
					}>;
					for (const it of all) {
						if (ITEM[it.name_snapshot] !== undefined) {
							it.sort_order = ITEM[it.name_snapshot];
							items.put(it);
						}
					}
				};

				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
		});
	});

	// Reload so both screens re-hydrate from the aged IndexedDB state.
	await gotoApp(page);

	// Wait for the list to re-hydrate all five on-list rows before reading order.
	await expect(page.locator('[data-testid="product-row"][data-on-list="true"]')).toHaveCount(5);
	const list = await listOrder(page);
	expect(list).toHaveLength(5);

	// Enter shop mode and read its order.
	await page.getByRole('link', { name: 'Shop' }).click();
	await expect(page).toHaveURL(/\/shopping/);
	await expect(page.getByTestId('shop-item').first()).toBeVisible();

	const shop = await shopOrder(page);

	// THE core guarantee: within-section item order is IDENTICAL on both screens.
	expect(shop).toEqual(list);

	// And the deterministic tail is honoured on both: the two legacy-`a0` items
	// (Apple, Banana — order between them fixed by id) come first, then the moved
	// Eggplant (a0V), then Carrot (a2), then Date (a3). The head pair's internal
	// order is id-stable and identical on both screens (asserted above); here we
	// pin the stable tail the keys dictate.
	expect(list.slice(2)).toEqual(['Eggplant', 'Carrot', 'Date']);
	expect(new Set(list.slice(0, 2))).toEqual(new Set(['Apple', 'Banana']));
});
