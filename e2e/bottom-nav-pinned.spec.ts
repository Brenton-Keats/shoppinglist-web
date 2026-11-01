import { test, expect } from '@playwright/test';
import { addNewProduct, gotoApp, resetAppState } from './helpers';

/**
 * Item 2 — the bottom navbar must stay pinned to the viewport bottom, including
 * when the mobile soft keyboard opens (reported on iOS Safari).
 *
 * MANUAL VERIFICATION REQUIRED: Playwright cannot raise the iOS soft keyboard,
 * so the true keyboard-shift behavior can only be confirmed by hand on a real
 * iOS Safari device (focus the search field; the nav must remain pinned to the
 * bottom of the visible area above the keyboard). The fix is CSS/viewport-meta:
 * `interactive-widget=resizes-content` on the viewport meta + a `100dvh` shell,
 * so the layout viewport (which `position: fixed` tracks) resizes WITH the
 * keyboard instead of being pushed up under it.
 *
 * This spec asserts the CSS CONTRACT that the fix depends on, which IS
 * machine-verifiable: the nav is `position: fixed`, flush to the viewport
 * bottom, high z-index, and no ancestor between it and the root establishes a
 * transform/filter/perspective containing block (which would silently break
 * fixed positioning and is the classic cause of this bug).
 */

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
});

test('bottom nav is fixed, flush to the viewport bottom, with a high stacking order', async ({
	page
}) => {
	await gotoApp(page);
	// Seed content so the page can scroll; the nav must not move with content.
	for (const name of ['Apples', 'Bananas', 'Carrots']) {
		await addNewProduct(page, name);
	}

	const nav = page.locator('nav');
	await expect(nav).toBeVisible();

	const styles = await nav.evaluate((el) => {
		const cs = getComputedStyle(el);
		return { position: cs.position, bottom: cs.bottom, zIndex: cs.zIndex };
	});
	expect(styles.position).toBe('fixed');
	expect(styles.bottom).toBe('0px');
	expect(Number(styles.zIndex)).toBeGreaterThanOrEqual(40);

	// The nav's box bottom must sit at the viewport bottom at rest.
	const viewport = page.viewportSize()!;
	const box = (await nav.boundingBox())!;
	expect(Math.round(box.y + box.height)).toBe(viewport.height);

	// No ancestor (up to <body>) may create a containing block that breaks
	// position:fixed — i.e. a non-'none' transform/filter/perspective.
	const hasBreakingAncestor = await nav.evaluate((el) => {
		let node: HTMLElement | null = el.parentElement;
		while (node && node.tagName !== 'BODY') {
			const cs = getComputedStyle(node);
			if (
				(cs.transform && cs.transform !== 'none') ||
				(cs.filter && cs.filter !== 'none') ||
				(cs.perspective && cs.perspective !== 'none')
			) {
				return true;
			}
			node = node.parentElement;
		}
		return false;
	});
	expect(hasBreakingAncestor).toBe(false);
});

test('viewport meta opts into interactive-widget=resizes-content (keyboard pinning)', async ({
	page
}) => {
	await gotoApp(page);
	const content = await page.locator('meta[name="viewport"]').getAttribute('content');
	expect(content).toContain('interactive-widget=resizes-content');
});
