import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/database';
import { recordChange, markChangesSynced } from '$lib/db/changes';
import { getPendingChanges } from '$lib/db/queries';

describe('IndexedDB operations', () => {
	beforeEach(async () => {
		// Clear all tables before each test
		await db.changes.clear();
		await db.lists.clear();
		await db.sections.clear();
		await db.stores.clear();
		await db.products.clear();
		await db.listItems.clear();
		await db.syncMeta.clear();
	});

	describe('recordChange', () => {
		it('creates a change record with correct fields', async () => {
			const change = await recordChange('Store', 'store-1', 'create', {
				id: 'store-1',
				name: 'Coles',
				active: true
			});

			expect(change.id).toBeDefined();
			expect(change.entity_type).toBe('Store');
			expect(change.entity_id).toBe('store-1');
			expect(change.operation).toBe('create');
			expect(change.synced).toBe(false);
			expect(change.revision).toBeNull();
			expect(change.payload).toEqual({ id: 'store-1', name: 'Coles', active: true });
		});

		it('stores the change in IndexedDB', async () => {
			await recordChange('Product', 'prod-1', 'create', { name: 'Milk' });

			const allChanges = await db.changes.toArray();
			expect(allChanges).toHaveLength(1);
			expect(allChanges[0].entity_type).toBe('Product');
		});
	});

	describe('getPendingChanges', () => {
		it('returns only unsynced changes', async () => {
			await recordChange('Store', 'store-1', 'create', { name: 'Coles' });
			await recordChange('Store', 'store-2', 'create', { name: 'Woolworths' });

			const pending = await getPendingChanges();
			expect(pending).toHaveLength(2);
		});

		it('excludes synced changes', async () => {
			const change = await recordChange('Store', 'store-1', 'create', { name: 'Coles' });
			await markChangesSynced([change.id], 1);

			const pending = await getPendingChanges();
			expect(pending).toHaveLength(0);
		});

		it('handles boolean false correctly (not numeric 0)', async () => {
			// This was a real bug: querying .where('synced').equals(0) missed boolean false
			await recordChange('Store', 'store-1', 'create', { name: 'Test' });

			const raw = await db.changes.toArray();
			expect(raw[0].synced).toBe(false);
			expect(typeof raw[0].synced).toBe('boolean');

			const pending = await getPendingChanges();
			expect(pending).toHaveLength(1);
		});
	});

	describe('markChangesSynced', () => {
		it('marks changes as synced with revision', async () => {
			const c1 = await recordChange('Store', 's1', 'create', { name: 'A' });
			const c2 = await recordChange('Store', 's2', 'create', { name: 'B' });

			await markChangesSynced([c1.id, c2.id], 5);

			const c1After = await db.changes.get(c1.id);
			const c2After = await db.changes.get(c2.id);

			expect(c1After?.synced).toBe(true);
			expect(c1After?.revision).toBe(5);
			expect(c2After?.synced).toBe(true);
			expect(c2After?.revision).toBe(5);
		});
	});

	describe('bulkPut with server data', () => {
		it('handles sanitized server data correctly', async () => {
			// Simulate data from the server (already JSON-parsed)
			const serverStores = [
				{ id: 'store-1', name: 'Coles', sort_order: 0, active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null },
				{ id: 'store-2', name: 'Woolworths', sort_order: 1, active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null }
			];

			// Sanitize like the sync engine does
			const sanitized = JSON.parse(JSON.stringify(serverStores.filter((item: any) => item && item.id)));

			await db.stores.bulkPut(sanitized);

			const stored = await db.stores.toArray();
			expect(stored).toHaveLength(2);
			expect(stored[0].name).toBe('Coles');
			expect(stored[1].name).toBe('Woolworths');
		});

		it('filters out items without id', async () => {
			const serverData = [
				{ id: 'valid-1', name: 'Good' },
				{ id: '', name: 'Empty ID' },
				{ name: 'No ID at all' },
				null
			];

			const sanitized = JSON.parse(JSON.stringify(serverData.filter((item: any) => item && item.id)));
			expect(sanitized).toHaveLength(1);
			expect(sanitized[0].id).toBe('valid-1');
		});

		it('strips non-cloneable values via JSON round-trip', async () => {
			const dataWithBadValues = [
				{
					id: 'test-1',
					name: 'Test',
					active: true,
					created_at: '2026-01-01T00:00:00Z',
					updated_at: '2026-01-01T00:00:00Z',
					deleted_at: null,
					sort_order: 0
				}
			];

			// Add non-serializable values (e.g. a Date instance or an undefined
			// field) that could slip in before the serialization boundary
			(dataWithBadValues[0] as any).badDate = new Date();
			(dataWithBadValues[0] as any).undefinedVal = undefined;

			const sanitized = JSON.parse(JSON.stringify(dataWithBadValues.filter((item: any) => item && item.id)));

			// undefined is stripped, Date becomes string
			expect(sanitized[0].undefinedVal).toBeUndefined();
			expect(typeof sanitized[0].badDate).toBe('string');

			// Should not throw DataCloneError
			await db.stores.bulkPut(sanitized);
			const stored = await db.stores.toArray();
			expect(stored).toHaveLength(1);
		});
	});
});

	describe('change coalescing', () => {
		beforeEach(async () => {
			await db.changes.clear();
		});

		it('merges create + update into single create with merged payload', async () => {
			await recordChange('Product', 'prod-1', 'create', { name: 'Milk', active: true });
			await recordChange('Product', 'prod-1', 'update', { default_section_id: 'sec-1' });

			const changes = await db.changes.toArray();
			expect(changes).toHaveLength(1);
			expect(changes[0].operation).toBe('create');
			expect(changes[0].payload).toEqual({ name: 'Milk', active: true, default_section_id: 'sec-1' });
		});

		it('merges update + update into single update with merged payload', async () => {
			await recordChange('Product', 'prod-1', 'update', { name: 'Whole Milk' });
			await recordChange('Product', 'prod-1', 'update', { default_store_id: 'store-1' });

			const changes = await db.changes.toArray();
			expect(changes).toHaveLength(1);
			expect(changes[0].operation).toBe('update');
			expect(changes[0].payload).toEqual({ name: 'Whole Milk', default_store_id: 'store-1' });
		});

		it('cancels create + delete (entity never existed on server)', async () => {
			await recordChange('Product', 'prod-1', 'create', { name: 'Milk' });
			await recordChange('Product', 'prod-1', 'delete', {});

			const changes = await db.changes.toArray();
			expect(changes).toHaveLength(0);
		});

		it('collapses update + delete into single delete', async () => {
			await recordChange('Product', 'prod-1', 'update', { name: 'Changed' });
			await recordChange('Product', 'prod-1', 'delete', {});

			const changes = await db.changes.toArray();
			expect(changes).toHaveLength(1);
			expect(changes[0].operation).toBe('delete');
			expect(changes[0].payload).toEqual({});
		});

		it('does not coalesce changes for different entities', async () => {
			await recordChange('Product', 'prod-1', 'create', { name: 'Milk' });
			await recordChange('Product', 'prod-2', 'create', { name: 'Bread' });

			const changes = await db.changes.toArray();
			expect(changes).toHaveLength(2);
		});

		it('does not coalesce changes for different entity types', async () => {
			await recordChange('Product', 'id-1', 'create', { name: 'Milk' });
			await recordChange('ListItem', 'id-1', 'create', { name_snapshot: 'Milk' });

			const changes = await db.changes.toArray();
			expect(changes).toHaveLength(2);
		});

		it('does not coalesce already-synced changes', async () => {
			const change = await recordChange('Product', 'prod-1', 'create', { name: 'Milk' });
			await markChangesSynced([change.id], 1);

			// This should create a new change, not merge with the synced one
			await recordChange('Product', 'prod-1', 'update', { name: 'Whole Milk' });

			const allChanges = await db.changes.toArray();
			expect(allChanges).toHaveLength(2);
			expect(allChanges.filter(c => !c.synced)).toHaveLength(1);
			expect(allChanges.find(c => !c.synced)?.operation).toBe('update');
		});

		it('merges multiple sequential updates', async () => {
			await recordChange('Store', 'store-1', 'create', { name: 'Coles' });
			await recordChange('Store', 'store-1', 'update', { sort_order: 'a1' });
			await recordChange('Store', 'store-1', 'update', { active: false });

			const changes = await db.changes.toArray();
			expect(changes).toHaveLength(1);
			expect(changes[0].operation).toBe('create');
			expect(changes[0].payload).toEqual({ name: 'Coles', sort_order: 'a1', active: false });
		});

		it('preserves section/store in payload when product is created then updated', async () => {
			// Mimics: addNewProductAndItem creates product, then saveProductEdit updates section/store
			await recordChange('Product', 'prod-new', 'create', {
				id: 'prod-new',
				name: 'Apples',
				default_section_id: null,
				default_store_id: null,
				active: true
			});

			// User then sets section and store via edit sheet
			await recordChange('Product', 'prod-new', 'update', {
				default_section_id: 'sec-produce',
				default_store_id: 'store-coles'
			});

			const changes = await db.changes.toArray();
			expect(changes).toHaveLength(1);
			expect(changes[0].operation).toBe('create');
			// Critical: the merged payload must contain the section and store
			expect(changes[0].payload.default_section_id).toBe('sec-produce');
			expect(changes[0].payload.default_store_id).toBe('store-coles');
			// And also the original fields
			expect(changes[0].payload.name).toBe('Apples');
			expect(changes[0].payload.active).toBe(true);
		});

		it('preserves sort_order when product is created then reordered', async () => {
			await recordChange('Product', 'prod-1', 'create', {
				id: 'prod-1',
				name: 'Milk',
				active: true
			});

			await recordChange('Product', 'prod-1', 'update', {
				sort_order: 'a0V'
			});

			const changes = await db.changes.toArray();
			expect(changes).toHaveLength(1);
			expect(changes[0].payload.sort_order).toBe('a0V');
			expect(changes[0].payload.name).toBe('Milk');
		});

		it('full product lifecycle: create + set section + set sort_order', async () => {
			await recordChange('Product', 'prod-x', 'create', {
				id: 'prod-x',
				name: 'Bread',
				default_section_id: null,
				default_store_id: null,
				active: true
			});

			await recordChange('Product', 'prod-x', 'update', {
				default_section_id: 'sec-bakery'
			});

			await recordChange('Product', 'prod-x', 'update', {
				default_store_id: 'store-woolworths'
			});

			await recordChange('Product', 'prod-x', 'update', {
				sort_order: 'a1'
			});

			const changes = await db.changes.toArray();
			expect(changes).toHaveLength(1);
			expect(changes[0].operation).toBe('create');
			expect(changes[0].payload).toEqual({
				id: 'prod-x',
				name: 'Bread',
				default_section_id: 'sec-bakery',
				default_store_id: 'store-woolworths',
				active: true,
				sort_order: 'a1'
			});
		});
});
