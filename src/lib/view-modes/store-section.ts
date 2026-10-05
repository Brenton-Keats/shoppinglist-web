import type { ListItem, Product, Section, Store } from '$lib/types';
import type { PrimaryGroup, SecondaryGroup, GroupedItem } from './types';
import { UNASSIGNED_ID, UNASSIGNED_SORT_ORDER } from './types';

function createProductMap(products: Product[]): Map<string, Product> {
	const map = new Map<string, Product>();
	for (const product of products) {
		map.set(product.id, product);
	}
	return map;
}

function toNumericSortOrder(value: string | number): number {
	const num = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(num) ? num : 0;
}

function sortSecondaryGroups(groups: SecondaryGroup[]): SecondaryGroup[] {
	return [...groups].sort((a, b) => {
		if (a.id === UNASSIGNED_ID && b.id !== UNASSIGNED_ID) return 1;
		if (b.id === UNASSIGNED_ID && a.id !== UNASSIGNED_ID) return -1;
		return a.sort_order - b.sort_order;
	});
}

function sortPrimaryGroups(groups: PrimaryGroup[]): PrimaryGroup[] {
	return [...groups].sort((a, b) => {
		if (a.id === UNASSIGNED_ID && b.id !== UNASSIGNED_ID) return 1;
		if (b.id === UNASSIGNED_ID && a.id !== UNASSIGNED_ID) return -1;
		return a.sort_order - b.sort_order;
	});
}

function sortGroupedItems(items: GroupedItem[]): GroupedItem[] {
	return [...items].sort((a, b) => toNumericSortOrder(a.item.sort_order) - toNumericSortOrder(b.item.sort_order));
}

function createFallbackProduct(item: ListItem): Product {
	return {
		id: item.product_id,
		name: item.name_snapshot,
		default_section_id: null,
		default_store_id: null,
		active: true,
		created_at: item.created_at,
		updated_at: item.updated_at,
		deleted_at: null
	};
}

/** A store/section usable as its own group: present and not soft-deleted. */
function isUsableStore(store: Store | undefined): store is Store {
	return store !== undefined && store.deleted_at === null;
}

function isUsableSection(section: Section | undefined): section is Section {
	return section !== undefined && section.deleted_at === null;
}

/**
 * Group items by store, then section.
 *
 * Item-driven: every non-deleted item is placed into exactly one primary and
 * one secondary group. An item whose store_id/section_id is null, or points at
 * a store/section that is missing or soft-deleted, folds into the "Any Store" /
 * "Uncategorized" fallback bucket. No item is ever dropped — the set of items
 * rendered equals the set of active items on the list, regardless of view mode.
 */
export async function groupByStoreSection(
	items: ListItem[],
	products: Product[],
	sections: Section[],
	stores: Store[]
): Promise<PrimaryGroup[]> {
	const productMap = createProductMap(products);
	const storeMap = new Map(stores.map((s) => [s.id, s] as const));
	const sectionMap = new Map(sections.map((s) => [s.id, s] as const));

	// Primary bucket (store) → secondary bucket (section) → items.
	interface SecondaryBucket {
		id: string;
		name: string;
		sort_order: number;
		items: ListItem[];
	}
	interface PrimaryBucket {
		id: string;
		name: string;
		sort_order: number;
		secondary: Map<string, SecondaryBucket>;
	}

	const primaries = new Map<string, PrimaryBucket>();

	const getPrimary = (store: Store | undefined): PrimaryBucket => {
		if (isUsableStore(store)) {
			let bucket = primaries.get(store.id);
			if (!bucket) {
				bucket = {
					id: store.id,
					name: store.name,
					sort_order: toNumericSortOrder(store.sort_order),
					secondary: new Map()
				};
				primaries.set(store.id, bucket);
			}
			return bucket;
		}
		let bucket = primaries.get(UNASSIGNED_ID);
		if (!bucket) {
			bucket = {
				id: UNASSIGNED_ID,
				name: 'Any Store',
				sort_order: UNASSIGNED_SORT_ORDER,
				secondary: new Map()
			};
			primaries.set(UNASSIGNED_ID, bucket);
		}
		return bucket;
	};

	const getSecondary = (primary: PrimaryBucket, section: Section | undefined): SecondaryBucket => {
		if (isUsableSection(section)) {
			let bucket = primary.secondary.get(section.id);
			if (!bucket) {
				bucket = {
					id: section.id,
					name: section.name,
					sort_order: toNumericSortOrder(section.sort_order),
					items: []
				};
				primary.secondary.set(section.id, bucket);
			}
			return bucket;
		}
		let bucket = primary.secondary.get(UNASSIGNED_ID);
		if (!bucket) {
			bucket = {
				id: UNASSIGNED_ID,
				name: 'Uncategorized',
				sort_order: UNASSIGNED_SORT_ORDER,
				items: []
			};
			primary.secondary.set(UNASSIGNED_ID, bucket);
		}
		return bucket;
	};

	for (const item of items) {
		if (item.deleted_at !== null) continue;

		const store = item.store_id === null ? undefined : storeMap.get(item.store_id);
		const section = item.section_id === null ? undefined : sectionMap.get(item.section_id);

		const primary = getPrimary(store);
		const secondary = getSecondary(primary, section);
		secondary.items.push(item);
	}

	const primaryGroups: PrimaryGroup[] = [];
	for (const primary of primaries.values()) {
		const secondaryGroups: SecondaryGroup[] = [];
		for (const secondary of primary.secondary.values()) {
			if (secondary.items.length === 0) continue;
			secondaryGroups.push({
				id: secondary.id === UNASSIGNED_ID ? UNASSIGNED_ID : secondary.id,
				name: secondary.name,
				sort_order: secondary.sort_order,
				items: sortGroupedItems(
					secondary.items.map((item) => ({
						item,
						product: productMap.get(item.product_id) ?? createFallbackProduct(item)
					}))
				)
			});
		}
		if (secondaryGroups.length === 0) continue;
		primaryGroups.push({
			id: primary.id,
			name: primary.name,
			sort_order: primary.sort_order,
			secondaryGroups: sortSecondaryGroups(secondaryGroups)
		});
	}

	return sortPrimaryGroups(primaryGroups);
}
