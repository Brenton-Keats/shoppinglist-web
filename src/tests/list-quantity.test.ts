import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/database';
import { listStore } from '$lib/stores/list.svelte';
import { getEntityById } from '$lib/db/operations';
import type { List, ListItem } from '$lib/types';

/**
 * Store-level coverage for the quantity adjust/set methods: they must persist
 * through updateListItem (recording a sync change), update the in-memory
 * this.items reactively, treat null as 1, and floor at 1.
 */
describe('ListStore quantity methods', () => {
	const LIST_ID = 'list-q';

	async function seedItem(id: string, quantity: number | null): Promise<ListItem> {
		const ts = new Date().toISOString();
		const item = {
			id,
			list_id: LIST_ID,
			product_id: `prod-${id}`,
			name_snapshot: id,
			section_id: null,
			store_id: null,
			quantity,
			unit: null,
			completed: false,
			completed_at: null,
			sort_order: 'a0',
			created_at: ts,
			updated_at: ts,
			deleted_at: null
		} as ListItem;
		await db.listItems.add(item);
		return item;
	}

	beforeEach(async () => {
		await db.changes.clear();
		await db.listItems.clear();
		await db.lists.clear();

		const ts = new Date().toISOString();
		await db.lists.add({
			id: LIST_ID,
			name: 'Q',
			status: 'ACTIVE',
			sort_order: 'a0',
			started_at: ts,
			archived_at: null,
			created_at: ts,
			updated_at: ts,
			deleted_at: null
		} as List);

		listStore.activeList = await db.lists.get(LIST_ID) as List;
		listStore.items = await db.listItems.where('list_id').equals(LIST_ID).toArray();
	});

	it('adjustItemQuantity(+1) raises by 1 and persists', async () => {
		const item = await seedItem('i1', 2);
		listStore.items = [item];

		await listStore.adjustItemQuantity('i1', 1);

		expect(listStore.items.find((i) => i.id === 'i1')?.quantity).toBe(3);
		const persisted = await getEntityById<ListItem>('listItems', 'i1');
		expect(persisted?.quantity).toBe(3);
	});

	it('adjustItemQuantity(-1) at 1 is a no-op (floor)', async () => {
		const item = await seedItem('i2', 1);
		listStore.items = [item];

		await listStore.adjustItemQuantity('i2', -1);

		expect(listStore.items.find((i) => i.id === 'i2')?.quantity).toBe(1);
		const persisted = await getEntityById<ListItem>('listItems', 'i2');
		// null (never written) OR 1 — both read as 1; the no-op skips the write.
		expect(persisted?.quantity ?? 1).toBe(1);
	});

	it('treats null quantity as 1: +1 yields 2', async () => {
		const item = await seedItem('i3', null);
		listStore.items = [item];

		await listStore.adjustItemQuantity('i3', 1);

		expect(listStore.items.find((i) => i.id === 'i3')?.quantity).toBe(2);
		const persisted = await getEntityById<ListItem>('listItems', 'i3');
		expect(persisted?.quantity).toBe(2);
	});

	it('setItemQuantity clamps below-floor values up to 1', async () => {
		const item = await seedItem('i4', 5);
		listStore.items = [item];

		await listStore.setItemQuantity('i4', 0);

		expect(listStore.items.find((i) => i.id === 'i4')?.quantity).toBe(1);
		const persisted = await getEntityById<ListItem>('listItems', 'i4');
		expect(persisted?.quantity).toBe(1);
	});

	it('records a sync change on quantity update', async () => {
		const item = await seedItem('i5', 1);
		listStore.items = [item];

		await listStore.adjustItemQuantity('i5', 1);

		const changes = await db.changes.toArray();
		const change = changes.find((c) => c.entity_id === 'i5' && c.operation === 'update');
		expect(change).toBeDefined();
		expect(change?.payload.quantity).toBe(2);
	});
});
