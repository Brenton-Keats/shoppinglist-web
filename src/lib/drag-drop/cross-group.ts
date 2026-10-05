import { db } from '$lib/db/database';
import { updateListItem } from '$lib/db/operations';
import { recordChange } from '$lib/db/changes';
import { compareSortKeys, sortKeyAfter } from '$lib/utils/ordering';
import type { ListItem } from '$lib/types';

/**
 * Move an item into a different (section, store) group, appending it to the end
 * of that group with a fresh fractional key after the current last item.
 */
export async function moveItemToGroup(
	itemId: string,
	targetSectionId: string | null,
	targetStoreId: string | null
): Promise<void> {
	const item = await db.listItems.get(itemId);
	if (!item || item.deleted_at !== null) return;

	const updates: Partial<ListItem> = {};
	if (targetSectionId !== undefined && item.section_id !== targetSectionId) {
		updates.section_id = targetSectionId;
	}
	if (targetStoreId !== undefined && item.store_id !== targetStoreId) {
		updates.store_id = targetStoreId;
	}

	if (Object.keys(updates).length === 0) return;

	const targetSection = updates.section_id ?? item.section_id;
	const targetStore = updates.store_id ?? item.store_id;

	const groupItems = (
		await db.listItems
			.where({ list_id: item.list_id })
			.and(
				(i) =>
					i.deleted_at === null &&
					i.id !== itemId &&
					i.section_id === targetSection &&
					i.store_id === targetStore
			)
			.toArray()
	).sort((a, b) => compareSortKeys(a.sort_order, b.sort_order));

	const lastKey = groupItems.length > 0 ? groupItems[groupItems.length - 1].sort_order : null;
	updates.sort_order = sortKeyAfter(lastKey);

	await updateListItem(itemId, updates);
	await recordChange('ListItem', itemId, 'update', { ...updates });
}
