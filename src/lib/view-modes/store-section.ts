import type { ListItem, Product, Section, Store } from '$lib/types';
import type { PrimaryGroup } from './types';
import { groupItems, storeAxis, sectionAxis } from './grouping';

/**
 * Group items by store, then section.
 *
 * Primary axis = store (ordered by store sort_order), secondary axis = section
 * (ordered by section sort_order), items ordered by their own sort_order. All
 * fractional-indexing (lexicographic) keys. Unassigned buckets sort last.
 */
export async function groupByStoreSection(
	items: ListItem[],
	products: Product[],
	sections: Section[],
	stores: Store[]
): Promise<PrimaryGroup[]> {
	return groupItems(items, products, storeAxis(stores), sectionAxis(sections));
}
