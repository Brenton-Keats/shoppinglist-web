import type { Table, UpdateSpec } from 'dexie';
import { db } from './database';
import { recordChange } from './changes';
import { serialize } from './serialize';
import { generateUUID, now, isSoftDeleted } from './utils';
import { compareSortKeys, sortKeyAfter } from '$lib/utils/ordering';
import type {
	BaseEntity,
	ChangeRecord,
	Product,
	List,
	Section,
	Store,
	ListItem
} from '$lib/types';

export async function createEntity<T extends BaseEntity>(
	table: string,
	entity: Omit<T, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<T> {
	const timestamp = now();
	const newEntity = {
		...entity,
		id: generateUUID(),
		created_at: timestamp,
		updated_at: timestamp,
		deleted_at: null
	} as T;

	await db.table<T>(table).add(serialize(newEntity));
	return newEntity;
}

/**
 * Create an entity appended to the END of its group, deriving its sort_order
 * from the MAX existing key in that group (by compareSortKeys) rather than from
 * a caller-supplied array position. The max read and the row write happen in a
 * single Dexie transaction, so two concurrent creates against an (apparently)
 * empty group cannot both read null and both emit "a0" — the second sees the
 * first's row and appends after it.
 *
 * `inGroup` selects the sibling set the new key is ordered within (active rows
 * only). Any `sort_order` on the supplied entity is ignored and overwritten.
 */
export async function createEntityAtEnd<T extends BaseEntity & { sort_order: string }>(
	table: string,
	changeEntity: ChangeRecord['entity_type'],
	entity: Omit<T, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>,
	inGroup: (e: T) => boolean = () => true
): Promise<T> {
	const tbl = db.table<T>(table) as Table<T, string>;

	return db.transaction('rw', tbl, db.changes, async () => {
		const all = await tbl.toArray();
		const maxKey = all
			.filter((e) => !isSoftDeleted(e) && inGroup(e))
			.reduce<string | null>((max, e) => {
				const key = e.sort_order ?? null;
				if (max === null) return key;
				return compareSortKeys(key, max) > 0 ? key : max;
			}, null);

		const timestamp = now();
		const newEntity = {
			...entity,
			sort_order: sortKeyAfter(maxKey),
			id: generateUUID(),
			created_at: timestamp,
			updated_at: timestamp,
			deleted_at: null
		} as T;

		await tbl.add(serialize(newEntity));
		await recordChange(changeEntity, newEntity.id, 'create', {
			...entity,
			sort_order: newEntity.sort_order
		});
		return newEntity;
	});
}

export async function updateEntity<T extends BaseEntity>(
	table: string,
	id: string,
	updates: Partial<T>
): Promise<T> {
	const timestamp = now();
	const changes = serialize({ ...updates, updated_at: timestamp }) as Partial<T>;

	await db.table<T>(table).update(id, changes as unknown as UpdateSpec<T>);

	const updated = await getEntityById<T>(table, id);
	if (!updated) {
		throw new Error(`Entity not found in table "${table}" with id "${id}"`);
	}
	return updated;
}

export async function softDeleteEntity<T extends BaseEntity>(
	table: string,
	id: string
): Promise<T> {
	const timestamp = now();

	await db.table<T>(table).update(id, { deleted_at: timestamp } as unknown as UpdateSpec<T>);

	const deleted = await getEntityById<T>(table, id);
	if (!deleted) {
		throw new Error(`Entity not found in table "${table}" with id "${id}"`);
	}
	return deleted;
}

export async function getEntityById<T>(table: string, id: string): Promise<T | undefined> {
	return db.table<T>(table).get(id);
}

export async function getAllEntities<T extends BaseEntity>(table: string): Promise<T[]> {
	return db.table<T>(table).toArray();
}

export async function getActiveEntities<T extends BaseEntity>(table: string): Promise<T[]> {
	const all = await getAllEntities<T>(table);
	return all.filter((e) => !isSoftDeleted(e));
}

export async function createProduct(
	data: Omit<Product, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<Product> {
	const product = await createEntity<Product>('products', data);
	await recordChange('Product', product.id, 'create', { ...data });
	return product;
}

/**
 * Create a product appended to the end of its default-section group, deriving
 * its sort_order atomically from the current group max. Pass the product data
 * without a sort_order (any supplied value is ignored).
 */
export async function createProductAtEnd(
	data: Omit<Product, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'sort_order'>
): Promise<Product> {
	const sectionId = data.default_section_id ?? null;
	return createEntityAtEnd<Product>(
		'products',
		'Product',
		{ ...data, sort_order: '' } as Omit<Product, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>,
		(p) => (p.default_section_id ?? null) === sectionId
	);
}

export async function updateProduct(id: string, updates: Partial<Product>): Promise<Product> {
	const product = await updateEntity<Product>('products', id, updates);
	await recordChange('Product', id, 'update', { ...updates });
	return product;
}

export async function softDeleteProduct(id: string): Promise<Product> {
	const product = await softDeleteEntity<Product>('products', id);
	await recordChange('Product', id, 'delete', {});
	return product;
}

export async function createList(
	data: Omit<List, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<List> {
	const list = await createEntity<List>('lists', data);
	await recordChange('List', list.id, 'create', { ...data });
	return list;
}

export async function updateList(id: string, updates: Partial<List>): Promise<List> {
	const list = await updateEntity<List>('lists', id, updates);
	await recordChange('List', id, 'update', { ...updates });
	return list;
}

export async function softDeleteList(id: string): Promise<List> {
	const list = await softDeleteEntity<List>('lists', id);
	await recordChange('List', id, 'delete', {});
	return list;
}

export async function createSection(
	data: Omit<Section, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<Section> {
	const section = await createEntity<Section>('sections', data);
	await recordChange('Section', section.id, 'create', { ...data });
	return section;
}

/**
 * Create a section appended to the end, deriving sort_order atomically from the
 * current max across all active sections.
 */
export async function createSectionAtEnd(
	data: Omit<Section, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'sort_order'>
): Promise<Section> {
	return createEntityAtEnd<Section>('sections', 'Section', {
		...data,
		sort_order: ''
	} as Omit<Section, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>);
}

export async function updateSection(id: string, updates: Partial<Section>): Promise<Section> {
	const section = await updateEntity<Section>('sections', id, updates);
	await recordChange('Section', id, 'update', { ...updates });
	return section;
}

export async function softDeleteSection(id: string): Promise<Section> {
	const section = await softDeleteEntity<Section>('sections', id);
	await recordChange('Section', id, 'delete', {});
	return section;
}

export async function createStore(
	data: Omit<Store, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<Store> {
	const store = await createEntity<Store>('stores', data);
	await recordChange('Store', store.id, 'create', { ...data });
	return store;
}

/**
 * Create a store appended to the end, deriving sort_order atomically from the
 * current max across all active stores.
 */
export async function createStoreAtEnd(
	data: Omit<Store, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'sort_order'>
): Promise<Store> {
	return createEntityAtEnd<Store>('stores', 'Store', {
		...data,
		sort_order: ''
	} as Omit<Store, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>);
}

export async function updateStore(id: string, updates: Partial<Store>): Promise<Store> {
	const store = await updateEntity<Store>('stores', id, updates);
	await recordChange('Store', id, 'update', { ...updates });
	return store;
}

export async function softDeleteStore(id: string): Promise<Store> {
	const store = await softDeleteEntity<Store>('stores', id);
	await recordChange('Store', id, 'delete', {});
	return store;
}

export async function createListItem(
	data: Omit<ListItem, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<ListItem> {
	const item = await createEntity<ListItem>('listItems', data);
	await recordChange('ListItem', item.id, 'create', { ...data });
	return item;
}

/**
 * Create a list item appended to the end of its list, deriving sort_order
 * atomically from the current max among the list's active items. Prevents two
 * quick adds against an empty list from both emitting "a0".
 */
export async function createListItemAtEnd(
	data: Omit<ListItem, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'sort_order'>
): Promise<ListItem> {
	const listId = data.list_id;
	return createEntityAtEnd<ListItem>(
		'listItems',
		'ListItem',
		{ ...data, sort_order: '' } as Omit<ListItem, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>,
		(i) => i.list_id === listId
	);
}

export async function updateListItem(id: string, updates: Partial<ListItem>): Promise<ListItem> {
	const item = await updateEntity<ListItem>('listItems', id, updates);
	await recordChange('ListItem', id, 'update', { ...updates });
	return item;
}

export async function softDeleteListItem(id: string): Promise<ListItem> {
	const item = await softDeleteEntity<ListItem>('listItems', id);
	await recordChange('ListItem', id, 'delete', {});
	return item;
}
