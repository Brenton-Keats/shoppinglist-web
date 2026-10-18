import { updateEntity, getActiveEntities } from '$lib/db/operations';
import { recordChange } from '$lib/db/changes';
import { db } from '$lib/db/database';
import { compareSortKeys, planReorder } from '$lib/utils/ordering';
import type { ChangeRecord, ListItem, Section, Store } from '$lib/types';

type SortableTable = 'stores' | 'sections' | 'listItems';

const CHANGE_ENTITY: Record<SortableTable, ChangeRecord['entity_type']> = {
	stores: 'Store',
	sections: 'Section',
	listItems: 'ListItem'
};

/**
 * Move `movingId` so it sits at `newIndex` within `ordered` (a list already
 * sorted by sort_order). In the happy path a single fractional key is written
 * for the moved row. If the destination neighbours carry degenerate keys
 * (equal/drifted) the whole group is rebalanced instead — see planReorder.
 *
 * All writes for a given move happen in one Dexie transaction so a rebalance is
 * atomic, and each changed row is recorded for sync via recordChange.
 */
async function moveWithinOrdered<T extends { id: string; sort_order: string }>(
	table: SortableTable,
	ordered: T[],
	movingId: string,
	newIndex: number
): Promise<void> {
	const writes = planReorder(ordered, movingId, newIndex);
	if (writes.length === 0) return;

	await db.transaction('rw', db.table(table), db.changes, async () => {
		for (const { id, sort_order } of writes) {
			await updateEntity(table, id, { sort_order } as Partial<T>);
			await recordChange(CHANGE_ENTITY[table], id, 'update', { sort_order });
		}
	});
}

export async function reorderStores(storeId: string, newIndex: number): Promise<void> {
	const stores = (await getActiveEntities<Store>('stores')).sort((a, b) =>
		compareSortKeys(a.sort_order, b.sort_order)
	);
	await moveWithinOrdered('stores', stores, storeId, newIndex);
}

export async function reorderSections(
	sectionId: string,
	newIndex: number,
	_listId?: string | null
): Promise<void> {
	const sections = (await getActiveEntities<Section>('sections')).sort((a, b) =>
		compareSortKeys(a.sort_order, b.sort_order)
	);
	await moveWithinOrdered('sections', sections, sectionId, newIndex);
}

export async function reorderItems(
	itemId: string,
	newIndex: number,
	groupKey: string
): Promise<void> {
	const [primaryType, primaryId, , secondaryId] = groupKey.split(':');
	if (!primaryType || !primaryId) return;

	const allItems = await getActiveEntities<ListItem>('listItems');
	const listId = allItems.find((i) => i.id === itemId)?.list_id;
	if (!listId) return;

	const hasSecondary = Boolean(secondaryId && secondaryId !== 'null');

	const groupItems = allItems.filter((i) => {
		if (i.list_id !== listId || i.deleted_at !== null) return false;
		if (primaryType === 'STORE_SECTION') {
			if (i.store_id !== primaryId) return false;
			return hasSecondary ? i.section_id === secondaryId : i.section_id === null;
		} else {
			if (i.section_id !== primaryId) return false;
			return hasSecondary ? i.store_id === secondaryId : i.store_id === null;
		}
	});

	groupItems.sort((a, b) => compareSortKeys(a.sort_order, b.sort_order));
	await moveWithinOrdered('listItems', groupItems, itemId, newIndex);
}
