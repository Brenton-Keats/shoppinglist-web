import { updateEntity, getActiveEntities } from '$lib/db/operations';
import { recordChange } from '$lib/db/changes';
import { compareSortKeys, sortKeyBetween } from '$lib/utils/ordering';
import type { ChangeRecord, ListItem, Section, Store } from '$lib/types';

type SortableTable = 'stores' | 'sections' | 'listItems';

const CHANGE_ENTITY: Record<SortableTable, ChangeRecord['entity_type']> = {
	stores: 'Store',
	sections: 'Section',
	listItems: 'ListItem'
};

/**
 * Move `movingId` so it sits at `newIndex` within `ordered` (a list already
 * sorted by sort_order), by generating a single fractional key roughly halfway
 * between the two neighbours at the destination. Only the moved row is written —
 * that is the point of fractional indexing: no renumbering of siblings.
 */
async function moveWithinOrdered<T extends { id: string; sort_order: string }>(
	table: SortableTable,
	ordered: T[],
	movingId: string,
	newIndex: number
): Promise<void> {
	const oldIndex = ordered.findIndex((e) => e.id === movingId);
	if (oldIndex === -1) return;

	// The sequence without the moving item, into which newIndex is interpreted.
	const without = ordered.filter((e) => e.id !== movingId);
	const clampedIndex = Math.max(0, Math.min(newIndex, without.length));

	const before = clampedIndex > 0 ? without[clampedIndex - 1].sort_order : null;
	const after = clampedIndex < without.length ? without[clampedIndex].sort_order : null;

	// No-op if it would land exactly where it already is.
	const current = ordered[oldIndex].sort_order;
	if (before === current || after === current) {
		// Already adjacent to its own position; still allow a true move elsewhere.
		if (
			(clampedIndex > 0 && without[clampedIndex - 1].id === movingId) ||
			(clampedIndex < without.length && without[clampedIndex].id === movingId)
		) {
			return;
		}
	}

	const newKey = sortKeyBetween(before, after);
	if (newKey === current) return;

	await updateEntity(table, movingId, { sort_order: newKey } as Partial<T>);
	await recordChange(CHANGE_ENTITY[table], movingId, 'update', { sort_order: newKey });
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
