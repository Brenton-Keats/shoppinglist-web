import type { Meal, MealProduct, Product } from '$lib/types';
import { db } from '$lib/db/database';
import {
	createMealAtEnd,
	createMealProduct,
	updateMeal,
	updateMealProduct,
	softDeleteMeal,
	softDeleteMealProduct,
	getActiveEntities
} from '$lib/db/operations';
import { compareSortKeys } from '$lib/utils/ordering';
import { adjustQuantity, clampQuantity, effectiveQuantity } from '$lib/utils/quantity';
import { syncStore } from './sync.svelte';
import { toastStore } from './toast.svelte';

/**
 * Store for the Phase-1 Meals management screen. Mirrors ListStore patterns:
 * Svelte 5 runes ($state), reactive arrays/maps, immutable updates, and a
 * pending-sync-count refresh through syncStore after every write (matching how
 * list.svelte.ts keeps the sync badge current).
 *
 * Scope decisions (Phase 1):
 *  - deleteMeal CASCADES: it soft-deletes the meal AND its MealProducts. This
 *    mirrors how the app treats dependent rows and keeps mealProducts free of
 *    orphan rows pointing at a deleted meal. (The alternative — leaving orphans
 *    to be filtered out — was rejected as less clean.)
 *  - addProductToMeal DEDUPES: if the product is already an active member of the
 *    meal it is a NO-OP (the user adjusts the existing row's quantity instead of
 *    creating a second row). name_snapshot is captured from the product's
 *    current name at add time, so a later product rename/delete can't break the
 *    meal display (mirrors ListItem.name_snapshot).
 *  - Quantity uses the SAME clamp/floor helpers as list items (quantity.ts):
 *    integer, floored at 1.
 */
class MealStore {
	meals = $state<Meal[]>([]);
	/** MealProducts for the currently-loaded meal, keyed by meal id. */
	mealProducts = $state<Map<string, MealProduct[]>>(new Map());
	/** All active products, for the add-product picker and name snapshots. */
	products = $state<Map<string, Product>>(new Map());
	loading = $state(false);

	get mealCount() {
		return this.meals.length;
	}

	private async refreshPending(): Promise<void> {
		syncStore.setPendingCount(await db.changes.where('synced').equals(0).count());
	}

	/** Load all active meals (sorted by sort_order) and the active product catalogue. */
	async loadMeals(): Promise<void> {
		this.loading = true;
		try {
			const [meals, allProducts] = await Promise.all([
				getActiveEntities<Meal>('meals'),
				getActiveEntities<Product>('products')
			]);
			this.meals = meals.sort((a, b) => compareSortKeys(a.sort_order, b.sort_order));
			this.products = new Map(allProducts.map((p) => [p.id, p]));
		} finally {
			this.loading = false;
		}
	}

	/** Load (and cache) the active MealProducts for a given meal. */
	async loadMealProducts(mealId: string): Promise<void> {
		const rows = await db.mealProducts
			.where('meal_id')
			.equals(mealId)
			.and((mp) => !mp.deleted_at)
			.toArray();
		this.mealProducts = new Map(this.mealProducts).set(mealId, rows);
	}

	/** The cached (active) MealProducts for a meal, or an empty array. */
	getMealProducts(mealId: string): MealProduct[] {
		return this.mealProducts.get(mealId) ?? [];
	}

	async createMeal(name: string): Promise<Meal | undefined> {
		const trimmed = name.trim();
		if (!trimmed) {
			toastStore.error('Meal name cannot be empty.');
			return undefined;
		}
		const meal = await createMealAtEnd({ name: trimmed, active: true });
		this.meals = [...this.meals, meal];
		await this.refreshPending();
		return meal;
	}

	async renameMeal(id: string, name: string): Promise<void> {
		const trimmed = name.trim();
		if (!trimmed) {
			toastStore.error('Meal name cannot be empty.');
			return;
		}
		await updateMeal(id, { name: trimmed });
		this.meals = this.meals.map((m) => (m.id === id ? { ...m, name: trimmed } : m));
		await this.refreshPending();
	}

	/**
	 * Soft-delete a meal AND cascade-soft-delete its (active) MealProducts, so no
	 * orphan membership rows linger pointing at a deleted meal.
	 */
	async deleteMeal(id: string): Promise<void> {
		const rows = this.mealProducts.get(id) ?? (await this.loadMealProductsInternal(id));
		await softDeleteMeal(id);
		for (const mp of rows) {
			await softDeleteMealProduct(mp.id);
		}
		this.meals = this.meals.filter((m) => m.id !== id);
		const next = new Map(this.mealProducts);
		next.delete(id);
		this.mealProducts = next;
		await this.refreshPending();
	}

	private async loadMealProductsInternal(mealId: string): Promise<MealProduct[]> {
		return db.mealProducts
			.where('meal_id')
			.equals(mealId)
			.and((mp) => !mp.deleted_at)
			.toArray();
	}

	/**
	 * Add a product to a meal with an integer quantity (default 1). Captures
	 * name_snapshot from the product's current name. If the product is already an
	 * active member of the meal, this is a NO-OP (returns the existing row) — the
	 * user adjusts its quantity instead of creating a duplicate.
	 */
	async addProductToMeal(
		mealId: string,
		productId: string,
		quantity = 1
	): Promise<MealProduct | undefined> {
		const existing = this.getMealProducts(mealId).find((mp) => mp.product_id === productId);
		if (existing) return existing; // dedupe: no second row

		const product = this.products.get(productId) ?? (await db.products.get(productId));
		if (!product) {
			toastStore.error('Product not found.');
			return undefined;
		}

		const mealProduct = await createMealProduct({
			meal_id: mealId,
			product_id: productId,
			name_snapshot: product.name,
			quantity: clampQuantity(quantity)
		});

		const rows = [...this.getMealProducts(mealId), mealProduct];
		this.mealProducts = new Map(this.mealProducts).set(mealId, rows);
		await this.refreshPending();
		return mealProduct;
	}

	/**
	 * Set a MealProduct's quantity to an explicit value, clamped to a positive
	 * integer floored at 1 (same logic as list items). No-op if unchanged.
	 */
	async setMealProductQuantity(mealProductId: string, quantity: number): Promise<void> {
		const entry = this.findMealProduct(mealProductId);
		if (!entry) return;
		const { mealId, mp } = entry;

		const next = clampQuantity(quantity);
		if (next === effectiveQuantity(mp.quantity)) return;

		try {
			await updateMealProduct(mealProductId, { quantity: next });
			this.updateLocalMealProduct(mealId, mealProductId, { quantity: next });
			await this.refreshPending();
		} catch (err) {
			console.error('Failed to set meal product quantity:', err);
			toastStore.error('Could not update quantity. Please try again.');
		}
	}

	/**
	 * Adjust a MealProduct's quantity by a delta (+1 / -1), treating the stored
	 * value as >=1 and flooring the result at 1. Decrementing at 1 is a no-op.
	 */
	async adjustMealProductQuantity(mealProductId: string, delta: number): Promise<void> {
		const entry = this.findMealProduct(mealProductId);
		if (!entry) return;
		await this.setMealProductQuantity(mealProductId, adjustQuantity(entry.mp.quantity, delta));
	}

	async removeProductFromMeal(mealProductId: string): Promise<void> {
		const entry = this.findMealProduct(mealProductId);
		if (!entry) return;
		const { mealId } = entry;

		await softDeleteMealProduct(mealProductId);
		const rows = this.getMealProducts(mealId).filter((mp) => mp.id !== mealProductId);
		this.mealProducts = new Map(this.mealProducts).set(mealId, rows);
		await this.refreshPending();
	}

	/** Locate a MealProduct (and its meal id) across the cached map. */
	private findMealProduct(
		mealProductId: string
	): { mealId: string; mp: MealProduct } | undefined {
		for (const [mealId, rows] of this.mealProducts) {
			const mp = rows.find((r) => r.id === mealProductId);
			if (mp) return { mealId, mp };
		}
		return undefined;
	}

	private updateLocalMealProduct(
		mealId: string,
		mealProductId: string,
		updates: Partial<MealProduct>
	): void {
		const rows = this.getMealProducts(mealId).map((mp) =>
			mp.id === mealProductId ? { ...mp, ...updates } : mp
		);
		this.mealProducts = new Map(this.mealProducts).set(mealId, rows);
	}

	/** Resolve a display name for a MealProduct, preferring the live product name. */
	getProductName(mp: MealProduct): string {
		const product = this.products.get(mp.product_id);
		return product?.name ?? mp.name_snapshot ?? 'Unknown';
	}

	async refresh(): Promise<void> {
		await this.loadMeals();
	}
}

export const mealStore = new MealStore();
