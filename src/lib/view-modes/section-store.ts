import type { ListItem, Product, Section, Store } from '$lib/types';
import type { PrimaryGroup } from './types';
import { groupItems, storeAxis, sectionAxis } from './grouping';

/**
 * Group items by section, then store.
 *
 * Primary axis = section (ordered by section sort_order), secondary axis = store
 * (ordered by store sort_order), items ordered by their own sort_order. All
 * fractional-indexing (lexicographic) keys. Unassigned buckets sort last.
 *
 * Products in the same section are therefore always adjacent (one primary group
 * per section), sub-ordered by store.
 */
export async function groupBySectionStore(
	items: ListItem[],
	products: Product[],
	sections: Section[],
	stores: Store[]
): Promise<PrimaryGroup[]> {
	return groupItems(items, products, sectionAxis(sections), storeAxis(stores));
}
