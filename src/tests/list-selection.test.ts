import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/database';
import { listStore } from '$lib/stores/list.svelte';
import { getLocalPreferences } from '$lib/db/queries';
import {
	startFreshList,
	switchToList,
	archiveSelectedList,
	deleteListById
} from '$lib/lists/list-actions';
import type { List, ListItem } from '$lib/types';

/**
 * List selection persistence + archive/delete behaviour.
 * Regression: switching tabs reloaded the active list and picked an arbitrary
 * ACTIVE list because the user's selection was never persisted.
 */
describe('list selection, archive and delete', () => {
	// Re-read through a function so TS does not narrow after `activeList = null`.
	const selected = (): List | null => listStore.activeList;

	async function seedList(
		id: string,
		opts: { status?: List['status']; created?: string; deleted?: boolean } = {}
	): Promise<List> {
		const ts = opts.created ?? new Date().toISOString();
		const list = {
			id,
			name: id,
			status: opts.status ?? 'ACTIVE',
			sort_order: 'a0',
			started_at: ts,
			archived_at: null,
			created_at: ts,
			updated_at: ts,
			deleted_at: opts.deleted ? ts : null
		} as List;
		await db.lists.add(list);
		return list;
	}

	async function seedItem(listId: string, id = `item-${listId}`) {
		const ts = new Date().toISOString();
		await db.listItems.add({
			id,
			list_id: listId,
			product_id: `p-${id}`,
			name_snapshot: id,
			section_id: null,
			store_id: null,
			quantity: 1,
			unit: null,
			completed: false,
			completed_at: null,
			sort_order: 'a0',
			created_at: ts,
			updated_at: ts,
			deleted_at: null
		} as ListItem);
	}

	beforeEach(async () => {
		await db.changes.clear();
		await db.listItems.clear();
		await db.lists.clear();
		await db.localPrefs.clear();
		listStore.activeList = null;
		listStore.items = [];
	});

	describe('selection persistence', () => {
		it('restores the selected list on reload instead of the first ACTIVE list', async () => {
			await seedList('a', { created: '2026-01-01T00:00:00Z' });
			const b = await seedList('b', { created: '2026-01-02T00:00:00Z' });

			await listStore.selectList(b);
			// Simulate a tab change / sync: store is reloaded from storage.
			listStore.activeList = null;
			await listStore.loadActiveList();

			expect(selected()?.id).toBe('b');
		});

		it('persists the selection to local preferences', async () => {
			const a = await seedList('a');
			await listStore.selectList(a);

			expect((await getLocalPreferences()).activeListId).toBe('a');
		});

		it('keeps an ARCHIVED list selected across a reload', async () => {
			await seedList('a');
			const old = await seedList('old', { status: 'ARCHIVED' });

			await listStore.selectList(old);
			listStore.activeList = null;
			await listStore.loadActiveList();

			expect(selected()?.id).toBe('old');
		});

		it('falls back to an ACTIVE list when the saved list was deleted', async () => {
			await seedList('a');
			const gone = await seedList('gone', { deleted: true });
			await listStore.selectList(gone);

			listStore.activeList = null;
			await listStore.loadActiveList();

			expect(selected()?.id).toBe('a');
		});

		it('falls back to an ACTIVE list when nothing was saved', async () => {
			await seedList('a');
			await listStore.loadActiveList();

			expect(selected()?.id).toBe('a');
		});

		it('switchToList selects, loads items and persists', async () => {
			await seedList('a');
			const b = await seedList('b');
			await seedItem('b');

			await switchToList(b);

			expect(selected()?.id).toBe('b');
			expect(listStore.items.map((i) => i.list_id)).toEqual(['b']);
			expect((await getLocalPreferences()).activeListId).toBe('b');
		});
	});

	describe('new list', () => {
		it('startFreshList creates and selects a list without archiving the previous one', async () => {
			const a = await seedList('a');
			await seedItem('a');
			await listStore.selectList(a);

			const created = await startFreshList();

			expect(selected()?.id).toBe(created.id);
			expect(created.id).not.toBe('a');
			expect((await db.lists.get('a'))?.status).toBe('ACTIVE');
			expect((await getLocalPreferences()).activeListId).toBe(created.id);
		});
	});

	describe('archiveSelectedList', () => {
		it('archives the selected list and switches to another active list without creating one', async () => {
			const a = await seedList('a', { created: '2026-01-01T00:00:00Z' });
			await seedList('b', { created: '2026-01-02T00:00:00Z' });
			await seedItem('a');
			await listStore.selectList(a);

			const result = await archiveSelectedList();

			expect(result).toBe(true);
			const archived = await db.lists.get('a');
			expect(archived?.status).toBe('ARCHIVED');
			expect(archived?.archived_at).toBeTruthy();
			expect(selected()?.id).toBe('b');
			expect(await db.lists.count()).toBe(2);
		});

		it('picks the most recently created remaining active list', async () => {
			const a = await seedList('a', { created: '2026-01-03T00:00:00Z' });
			await seedList('b', { created: '2026-01-01T00:00:00Z' });
			await seedList('c', { created: '2026-01-02T00:00:00Z' });
			await seedList('arch', { status: 'ARCHIVED', created: '2026-01-04T00:00:00Z' });
			await seedItem('a');
			await listStore.selectList(a);

			await archiveSelectedList();

			expect(selected()?.id).toBe('c');
		});

		it('creates a new list only when no other active list exists', async () => {
			const a = await seedList('a');
			await seedItem('a');
			await listStore.selectList(a);

			await archiveSelectedList();

			expect((await db.lists.get('a'))?.status).toBe('ARCHIVED');
			expect(await db.lists.count()).toBe(2);
			expect(selected()?.id).not.toBe('a');
			expect(selected()?.status).toBe('ACTIVE');
		});

		it('ignores deleted lists when choosing a replacement', async () => {
			const a = await seedList('a');
			await seedList('dead', { deleted: true });
			await seedItem('a');
			await listStore.selectList(a);

			await archiveSelectedList();

			expect(selected()?.id).not.toBe('dead');
			expect(await db.lists.count()).toBe(3);
		});

		it('does nothing for an empty list', async () => {
			const a = await seedList('a');
			await listStore.selectList(a);

			const result = await archiveSelectedList();

			expect(result).toBe(false);
			expect((await db.lists.get('a'))?.status).toBe('ACTIVE');
			expect(selected()?.id).toBe('a');
		});

		it('does nothing when no list is selected', async () => {
			expect(await archiveSelectedList()).toBe(false);
		});
	});

	describe('deleteListById', () => {
		it('soft-deletes a non-selected list and keeps the selection', async () => {
			const a = await seedList('a');
			await seedList('b');
			await listStore.selectList(a);

			await deleteListById('b');

			expect((await db.lists.get('b'))?.deleted_at).toBeTruthy();
			expect(selected()?.id).toBe('a');
			expect(await db.lists.count()).toBe(2);
		});

		it('records a sync delete change', async () => {
			const a = await seedList('a');
			await seedList('b');
			await listStore.selectList(a);

			await deleteListById('b');

			const changes = await db.changes.toArray();
			expect(changes.some((c) => c.entity_type === 'List' && c.entity_id === 'b' && c.operation === 'delete')).toBe(true);
		});

		it('switches to another active list when the selected list is deleted', async () => {
			const a = await seedList('a', { created: '2026-01-01T00:00:00Z' });
			await seedList('b', { created: '2026-01-02T00:00:00Z' });
			await listStore.selectList(a);

			await deleteListById('a');

			expect((await db.lists.get('a'))?.deleted_at).toBeTruthy();
			expect(selected()?.id).toBe('b');
			expect(await db.lists.count()).toBe(2);
		});

		it('creates a fresh list when the only list is deleted', async () => {
			const a = await seedList('a');
			await listStore.selectList(a);

			await deleteListById('a');

			expect(selected()?.id).not.toBe('a');
			expect(selected()?.status).toBe('ACTIVE');
		});

		it('can delete an archived list', async () => {
			const a = await seedList('a');
			await seedList('old', { status: 'ARCHIVED' });
			await listStore.selectList(a);

			await deleteListById('old');

			expect((await db.lists.get('old'))?.deleted_at).toBeTruthy();
			expect(selected()?.id).toBe('a');
		});
	});
});
