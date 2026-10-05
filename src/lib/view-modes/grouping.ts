import type { ListItem, Product, Section, Store } from '$lib/types';
import type { PrimaryGroup, SecondaryGroup, GroupedItem } from './types';
import { UNASSIGNED_ID, UNASSIGNED_SORT_ORDER } from './types';
import { compareSortKeys } from '$lib/utils/ordering';

/**
 * Shared item-driven grouping used by both view modes.
 *
 * The two modes differ only in which entity is the primary grouping axis:
 * STORE_SECTION groups store → section, SECTION_STORE groups section → store.
 * In both, items within a leaf bucket are ordered by their own fractional
 * sort_order, and every level is sorted lexicographically by the underlying
 * entity's fractional sort_order (with the "unassigned" bucket always last).
 *
 * Because grouping is item-driven, every non-deleted item lands in exactly one
 * leaf bucket — an item whose primary/secondary entity is null, missing, or
 * soft-deleted folds into the unassigned fallback rather than being dropped.
 */

export interface GroupingAxis {
	/** The entity id this item belongs to on this axis, or null if unassigned. */
	idOf: (item: ListItem) => string | null;
	/** Resolve a usable (present, not soft-deleted) entity for an id. */
	lookup: (id: string) => { name: string; sort_order: string } | undefined;
	/** Display name for the unassigned bucket on this axis. */
	unassignedName: string;
}

interface Bucket {
	id: string;
	name: string;
	sort_order: string;
	items: ListItem[];
	/** Secondary buckets keyed by secondary id (primary buckets only). */
	children: Map<string, Bucket>;
}

function createProductMap(products: Product[]): Map<string, Product> {
	const map = new Map<string, Product>();
	for (const product of products) map.set(product.id, product);
	return map;
}

function createFallbackProduct(item: ListItem): Product {
	return {
		id: item.product_id,
		name: item.name_snapshot,
		default_section_id: null,
		default_store_id: null,
		sort_order: item.sort_order,
		active: true,
		created_at: item.created_at,
		updated_at: item.updated_at,
		deleted_at: null
	};
}

/** Lexicographic group sort with the unassigned bucket forced last. */
function compareGroups(
	a: { id: string | null; sort_order: string },
	b: { id: string | null; sort_order: string }
): number {
	if (a.id === UNASSIGNED_ID && b.id !== UNASSIGNED_ID) return 1;
	if (b.id === UNASSIGNED_ID && a.id !== UNASSIGNED_ID) return -1;
	return compareSortKeys(a.sort_order, b.sort_order);
}

function sortGroupedItems(items: GroupedItem[]): GroupedItem[] {
	return [...items].sort((a, b) => compareSortKeys(a.item.sort_order, b.item.sort_order));
}

function getOrCreateBucket(
	map: Map<string, Bucket>,
	item: ListItem,
	axis: GroupingAxis
): Bucket {
	const id = axis.idOf(item);
	const entity = id !== null ? axis.lookup(id) : undefined;

	if (id !== null && entity) {
		let bucket = map.get(id);
		if (!bucket) {
			bucket = { id, name: entity.name, sort_order: entity.sort_order, items: [], children: new Map() };
			map.set(id, bucket);
		}
		return bucket;
	}

	let bucket = map.get(UNASSIGNED_ID);
	if (!bucket) {
		bucket = {
			id: UNASSIGNED_ID,
			name: axis.unassignedName,
			sort_order: UNASSIGNED_SORT_ORDER,
			items: [],
			children: new Map()
		};
		map.set(UNASSIGNED_ID, bucket);
	}
	return bucket;
}

/**
 * Group items along a primary then secondary axis, returning fully sorted
 * PrimaryGroups. `primary` and `secondary` select the two axes.
 */
export function groupItems(
	items: ListItem[],
	products: Product[],
	primary: GroupingAxis,
	secondary: GroupingAxis
): PrimaryGroup[] {
	const productMap = createProductMap(products);
	const primaries = new Map<string, Bucket>();

	for (const item of items) {
		if (item.deleted_at !== null) continue;
		const primaryBucket = getOrCreateBucket(primaries, item, primary);
		const secondaryBucket = getOrCreateBucket(primaryBucket.children, item, secondary);
		secondaryBucket.items.push(item);
	}

	const result: PrimaryGroup[] = [];
	for (const primaryBucket of primaries.values()) {
		const secondaryGroups: SecondaryGroup[] = [];
		for (const secondaryBucket of primaryBucket.children.values()) {
			if (secondaryBucket.items.length === 0) continue;
			secondaryGroups.push({
				id: secondaryBucket.id,
				name: secondaryBucket.name,
				sort_order: secondaryBucket.sort_order,
				items: sortGroupedItems(
					secondaryBucket.items.map((item) => ({
						item,
						product: productMap.get(item.product_id) ?? createFallbackProduct(item)
					}))
				)
			});
		}
		if (secondaryGroups.length === 0) continue;
		secondaryGroups.sort(compareGroups);
		result.push({
			id: primaryBucket.id,
			name: primaryBucket.name,
			sort_order: primaryBucket.sort_order,
			secondaryGroups
		});
	}

	result.sort(compareGroups);
	return result;
}

/** Axis factory for the Store grouping dimension. */
export function storeAxis(stores: Store[]): GroupingAxis {
	const map = new Map(stores.map((s) => [s.id, s] as const));
	return {
		idOf: (item) => item.store_id,
		lookup: (id) => {
			const s = map.get(id);
			return s && s.deleted_at === null ? { name: s.name, sort_order: s.sort_order } : undefined;
		},
		unassignedName: 'Any Store'
	};
}

/** Axis factory for the Section grouping dimension. */
export function sectionAxis(sections: Section[]): GroupingAxis {
	const map = new Map(sections.map((s) => [s.id, s] as const));
	return {
		idOf: (item) => item.section_id,
		lookup: (id) => {
			const s = map.get(id);
			return s && s.deleted_at === null ? { name: s.name, sort_order: s.sort_order } : undefined;
		},
		unassignedName: 'Uncategorized'
	};
}
