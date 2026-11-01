import { test, expect } from '@playwright/test';
import { addNewProduct, gotoApp, resetAppState } from './helpers';

/**
 * Item 3 — the "Exit shopping" control must stay fixed to the viewport bottom
 * regardless of list length. It was fine on short lists but scrolled off-screen
 * on long ones.
 *
 * Approach (consistent with Item 2): the shopping page is a `h-[100dvh]` flex
 * column, the item list is the ONLY scroll context (`flex-1 overflow-y-auto`),
 * and the Exit footer is a non-scrolling flex child OUTSIDE that scroll
 * container — so it is pinned to the bottom of the viewport by layout, with
 * safe-area padding. This test seeds a long list, scrolls the content to the
 * bottom, and asserts the Exit button stays within the viewport.
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

test('Exit shopping button stays pinned to the viewport bottom on a long list', async ({
	page
}) => {
	await gotoApp(page);

	// Seed enough items to overflow the viewport comfortably.
	for (let i = 0; i < 12; i++) {
		await addNewProduct(page, `Item ${i}`);
	}

	await page.getByRole('link', { name: 'Shop' }).click();
	await expect(page).toHaveURL(/\/shopping/);

	const exit = page.getByTestId('exit-shopping');
	await expect(exit).toBeVisible();

	// The scrollable content region is the only scroll context on this page.
	const scroller = page.locator('.overflow-y-auto').first();
	await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
	await page.waitForTimeout(100);

	// After scrolling to the bottom, the Exit button must still be within the
	// viewport (its box bottom at or above the viewport bottom edge).
	const viewport = page.viewportSize()!;
	const box = (await exit.boundingBox())!;
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
	await expect(exit).toBeInViewport();

	// The exit control must NOT live inside an ACTUALLY-SCROLLING container — that
	// is what would let it scroll off. (An ancestor with overflow-y:auto that
	// does not overflow its content is fine; only a real scroller matters.)
	const insideActiveScroller = await exit.evaluate((el) => {
		let node: HTMLElement | null = el.parentElement;
		while (node) {
			const cs = getComputedStyle(node);
			const scrolls = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
			if (scrolls && node.scrollHeight > node.clientHeight + 1) return true;
			node = node.parentElement;
		}
		return false;
	});
	expect(insideActiveScroller).toBe(false);
});
