import type { ViewMode, ListItem, Section, Store } from '$lib/types';
import { compareSortKeys } from '$lib/utils/ordering';

export interface GroupedItems {
	primaryId: string;
	primaryName: string;
	secondaryGroups: {
		secondaryId: string;
		secondaryName: string;
		items: ListItem[];
	}[];
}

/** Sort group keys by the entity's fractional sort_order, with 'none' last. */
function sortGroupKeys<T extends { sort_order: string }>(
	keys: string[],
	entityMap: Map<string, T>
): string[] {
	return [...keys].sort((a, b) => {
		if (a === 'none' && b !== 'none') return 1;
		if (b === 'none' && a !== 'none') return -1;
		const ea = entityMap.get(a);
		const eb = entityMap.get(b);
		if (!ea && !eb) return 0;
		if (!ea) return 1;
		if (!eb) return -1;
		return compareSortKeys(ea.sort_order, eb.sort_order);
	});
}

/** Order items within a bucket by their own fractional sort_order. */
function sortItems(items: ListItem[]): ListItem[] {
	return [...items].sort((a, b) => compareSortKeys(a.sort_order, b.sort_order));
}

export function groupItemsByViewMode(
	items: ListItem[],
	viewMode: ViewMode,
	sections: Section[],
	stores: Store[]
): GroupedItems[] {
	const sectionMap = new Map(sections.map((s) => [s.id, s]));
	const storeMap = new Map(stores.map((s) => [s.id, s]));

	if (viewMode === 'SECTION_STORE') {
		const bySection = new Map<string, ListItem[]>();
		for (const item of items) {
			const sectionId = item.section_id ?? 'none';
			const list = bySection.get(sectionId) ?? [];
			list.push(item);
			bySection.set(sectionId, list);
		}

		const sortedSections = sortGroupKeys([...bySection.keys()], sectionMap);

		return sortedSections.map((sectionId) => {
			const section = sectionMap.get(sectionId);
			const sectionItems = bySection.get(sectionId) ?? [];

			const byStore = new Map<string, ListItem[]>();
			for (const item of sectionItems) {
				const storeId = item.store_id ?? 'none';
				const list = byStore.get(storeId) ?? [];
				list.push(item);
				byStore.set(storeId, list);
			}

			const sortedStores = sortGroupKeys([...byStore.keys()], storeMap);

			return {
				primaryId: sectionId,
				primaryName: section?.name ?? 'Uncategorized',
				secondaryGroups: sortedStores.map((storeId) => ({
					secondaryId: storeId,
					secondaryName: storeMap.get(storeId)?.name ?? 'Any Store',
					items: sortItems(byStore.get(storeId) ?? [])
				}))
			};
		});
	} else {
		const byStore = new Map<string, ListItem[]>();
		for (const item of items) {
			const storeId = item.store_id ?? 'none';
			const list = byStore.get(storeId) ?? [];
			list.push(item);
			byStore.set(storeId, list);
		}

		const sortedStores = sortGroupKeys([...byStore.keys()], storeMap);

		return sortedStores.map((storeId) => {
			const store = storeMap.get(storeId);
			const storeItems = byStore.get(storeId) ?? [];

			const bySection = new Map<string, ListItem[]>();
			for (const item of storeItems) {
				const sectionId = item.section_id ?? 'none';
				const list = bySection.get(sectionId) ?? [];
				list.push(item);
				bySection.set(sectionId, list);
			}

			const sortedSections = sortGroupKeys([...bySection.keys()], sectionMap);

			return {
				primaryId: storeId,
				primaryName: store?.name ?? 'Any Store',
				secondaryGroups: sortedSections.map((sectionId) => ({
					secondaryId: sectionId,
					secondaryName: sectionMap.get(sectionId)?.name ?? 'Uncategorized',
					items: sortItems(bySection.get(sectionId) ?? [])
				}))
			};
		});
	}
}
