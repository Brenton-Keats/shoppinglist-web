import type { ViewMode, ListItem, Product } from '$lib/types';

export interface ViewModeConfig {
	id: ViewMode;
	name: string;
	description: string;
}

export const VIEW_MODES: ViewModeConfig[] = [
	{ id: 'STORE_SECTION', name: 'Store → Section', description: 'Group by store, then section' },
	{ id: 'SECTION_STORE', name: 'Section → Store', description: 'Group by section, then store' }
];

export interface GroupedItem {
	item: ListItem;
	product: Product;
}

export interface PrimaryGroup {
	id: string;
	name: string;
	/** Fractional-indexing key of the underlying store/section (for ordering). */
	sort_order: string;
	secondaryGroups: SecondaryGroup[];
}

export interface SecondaryGroup {
	id: string | null;
	name: string;
	/** Fractional-indexing key of the underlying store/section (for ordering). */
	sort_order: string;
	items: GroupedItem[];
}

export const UNASSIGNED_ID = '__unassigned__';
export const UNASSIGNED_NAME = 'Unassigned';
/** Unassigned groups always sort last. UNASSIGNED_ID is checked explicitly in
 * the group comparators, so this constant is only a placeholder key value. */
export const UNASSIGNED_SORT_ORDER = '';
