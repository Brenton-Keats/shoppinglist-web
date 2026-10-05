import type { List, ListItem, Product, Section, Store } from '$lib/types';
import { db } from '$lib/db/database';
import { sortKeyAfter, compareSortKeys } from '$lib/utils/ordering';
import {
	getActiveList,
	getItemsByList
} from '$lib/db/queries';
import {
	createProduct,
	createListItem,
	updateListItem,
	softDeleteListItem,
	getActiveEntities
} from '$lib/db/operations';
import { syncStore } from './sync.svelte';

export interface ListState {
	activeList: List | null;
	items: ListItem[];
	products: Map<string, Product>;
	sections: Map<string, Section>;
	stores: Map<string, Store>;
	loading: boolean;
}

class ListStore {
	activeList = $state<List | null>(null);
	items = $state<ListItem[]>([]);
	products = $state<Map<string, Product>>(new Map());
	sections = $state<Map<string, Section>>(new Map());
	stores = $state<Map<string, Store>>(new Map());
	loading = $state(false);

	get itemCount() {
		return this.items.length;
	}

	get completedCount() {
		return this.items.filter((i) => i.completed).length;
	}

	async loadActiveList(): Promise<void> {
		this.loading = true;
		try {
			const list = await getActiveList();
			this.activeList = list ?? null;

			if (list) {
				await this.loadListData(list.id);
			} else {
				this.items = [];
				this.products = new Map();
				this.sections = new Map();
				this.stores = new Map();
			}
		} finally {
			this.loading = false;
		}
	}

	async loadListData(listId: string): Promise<void> {
		const [items, allProducts, allSections, allStores] = await Promise.all([
			getItemsByList(listId),
			getActiveEntities<Product>('products'),
			getActiveEntities<Section>('sections'),
			getActiveEntities<Store>('stores')
		]);

		this.items = items;
		this.products = new Map(allProducts.map((p) => [p.id, p]));
		this.sections = new Map(allSections.map((s) => [s.id, s]));
		this.stores = new Map(allStores.map((s) => [s.id, s]));
	}

	async addItem(
		productId: string,
		sectionId?: string | null,
		storeId?: string | null
	): Promise<void> {
		if (!this.activeList) return;

		const product = this.products.get(productId);
		if (!product) {
			const p = await db.products.get(productId);
			if (!p) throw new Error(`Product ${productId} not found`);
		}

		const resolvedProduct = product ?? (await db.products.get(productId))!;

		const existing = this.items.find((i) => i.product_id === productId);
		if (existing) return;

		const item = await createListItem({
			list_id: this.activeList.id,
			product_id: productId,
			name_snapshot: resolvedProduct.name,
			section_id: sectionId ?? resolvedProduct.default_section_id ?? null,
			store_id: storeId ?? resolvedProduct.default_store_id ?? null,
			quantity: null,
			unit: null,
			completed: false,
			completed_at: null,
			sort_order: sortKeyAfter(this.items.length > 0 ? this.items[this.items.length - 1].sort_order : null)
		});

		this.items = [...this.items, item];
		syncStore.setPendingCount(await db.changes.where('synced').equals(0).count());
	}

	async addNewProductAndItem(
		name: string,
		sectionId?: string | null,
		storeId?: string | null
	): Promise<void> {
		if (!this.activeList) return;

		const lastProductKey = [...this.products.values()]
			.sort((a, b) => compareSortKeys(a.sort_order, b.sort_order))
			.at(-1)?.sort_order ?? null;

		const product = await createProduct({
			name: name.trim(),
			default_section_id: sectionId ?? null,
			default_store_id: storeId ?? null,
			sort_order: sortKeyAfter(lastProductKey),
			active: true
		});

		this.products = new Map(this.products).set(product.id, product);

		const item = await createListItem({
			list_id: this.activeList.id,
			product_id: product.id,
			name_snapshot: product.name,
			section_id: sectionId ?? null,
			store_id: storeId ?? null,
			quantity: null,
			unit: null,
			completed: false,
			completed_at: null,
			sort_order: sortKeyAfter(this.items.length > 0 ? this.items[this.items.length - 1].sort_order : null)
		});

		this.items = [...this.items, item];
		syncStore.setPendingCount(await db.changes.where('synced').equals(0).count());
	}

	async removeItem(itemId: string): Promise<void> {
		await softDeleteListItem(itemId);
		this.items = this.items.filter((i) => i.id !== itemId);
		syncStore.setPendingCount(await db.changes.where('synced').equals(0).count());
	}

	async toggleItem(itemId: string): Promise<void> {
		const item = this.items.find((i) => i.id === itemId);
		if (!item) return;

		const completed = !item.completed;
		const completed_at = completed ? new Date().toISOString() : null;

		await updateListItem(itemId, { completed, completed_at });

		this.items = this.items.map((i) =>
			i.id === itemId ? { ...i, completed, completed_at } : i
		);
		syncStore.setPendingCount(await db.changes.where('synced').equals(0).count());
	}

	async refresh(): Promise<void> {
		if (this.activeList) {
			await this.loadListData(this.activeList.id);
		} else {
			await this.loadActiveList();
		}
	}

	getProductName(productId: string): string {
		const product = this.products.get(productId);
		return product?.name ?? 'Unknown';
	}

	getSectionName(sectionId: string | null): string | null {
		if (!sectionId) return null;
		const section = this.sections.get(sectionId);
		return section?.name ?? null;
	}

	getStoreName(storeId: string | null): string | null {
		if (!storeId) return null;
		const store = this.stores.get(storeId);
		return store?.name ?? null;
	}
}

export const listStore = new ListStore();
