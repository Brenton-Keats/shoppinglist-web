import { db } from '$lib/db/database';
import { createList, updateList, softDeleteList } from '$lib/db/operations';
import { sortKeyAfter } from '$lib/utils/ordering';
import { listStore } from '$lib/stores/list.svelte';
import { mealStore } from '$lib/stores/meal.svelte';
import type { List } from '$lib/types';

/** Create a new ACTIVE list, select it, and auto-select the usuals. */
export async function startFreshList(): Promise<List> {
	const list = await createList({
		name: 'Shopping List',
		status: 'ACTIVE',
		sort_order: sortKeyAfter(null),
		started_at: new Date().toISOString(),
		archived_at: null
	});
	await listStore.selectList(list);
	// New list → auto-select the usuals (trigger policy: creation only).
	await mealStore.ensureUsualsSelected(list.id);
	await mealStore.loadSelections(list.id);
	return list;
}

/** Select an existing list and load its meal selections. */
export async function switchToList(list: List): Promise<void> {
	await listStore.selectList(list);
	await mealStore.loadSelections(list.id);
}

/** Most recently created ACTIVE list other than `excludeId`, if any. */
async function findOtherActiveList(excludeId: string): Promise<List | undefined> {
	const lists = await db.lists.where('status').equals('ACTIVE').toArray();
	return lists
		.filter((l) => !l.deleted_at && l.id !== excludeId)
		.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
}

/** After the selected list is archived/deleted, move to another list. */
async function selectReplacementList(removedId: string): Promise<void> {
	const next = await findOtherActiveList(removedId);
	if (next) {
		await switchToList(next);
	} else {
		// The app always needs a selected list.
		await startFreshList();
	}
}

/**
 * Archive the selected list. Returns false (and does nothing) when there is no
 * selected list or it is empty. Switches to another active list if one exists;
 * a new list is created only when nothing else is left.
 */
export async function archiveSelectedList(): Promise<boolean> {
	const current = listStore.activeList;
	if (!current || listStore.items.length === 0) return false;

	await updateList(current.id, {
		status: 'ARCHIVED',
		archived_at: new Date().toISOString()
	});
	await selectReplacementList(current.id);
	return true;
}

/** Soft-delete a list; if it was selected, move to a replacement. */
export async function deleteListById(id: string): Promise<void> {
	await softDeleteList(id);
	if (id === listStore.activeList?.id) {
		await selectReplacementList(id);
	}
}
