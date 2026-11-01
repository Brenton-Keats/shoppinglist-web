import Dexie, { type EntityTable } from 'dexie';
import type {
	Product,
	List,
	Section,
	Store,
	ListItem,
	Meal,
	MealProduct,
	MealSelection,
	ChangeRecord,
	LocalPreferences
} from '$lib/types';

interface SyncMeta {
	id: string;
	lastRevision: number | null;
	lastSyncTime: string | null;
}

class ShoppingListDatabase extends Dexie {
	products!: EntityTable<Product, 'id'>;
	lists!: EntityTable<List, 'id'>;
	sections!: EntityTable<Section, 'id'>;
	stores!: EntityTable<Store, 'id'>;
	listItems!: EntityTable<ListItem, 'id'>;
	meals!: EntityTable<Meal, 'id'>;
	mealProducts!: EntityTable<MealProduct, 'id'>;
	mealSelections!: EntityTable<MealSelection, 'id'>;
	changes!: EntityTable<ChangeRecord, 'id'>;
	syncMeta!: EntityTable<SyncMeta, 'id'>;
	localPrefs!: EntityTable<LocalPreferences, 'deviceId'>;

	constructor() {
		super('ShoppingListDB');

		this.version(2).stores({
			products: 'id, name',
			lists: 'id, status',
			sections: 'id, list_id',
			stores: 'id',
			listItems: 'id, list_id, product_id, section_id, store_id, completed',
			changes: 'id, synced, revision',
			syncMeta: 'id',
			localPrefs: 'deviceId'
		});

		// v3: add the meals entities. Additive migration — Dexie merges the store
		// map, creating the three new tables and leaving existing ones untouched;
		// no backfill needed. No sort_order index (project convention: sort in
		// memory via .sortBy / compareSortKeys).
		this.version(3).stores({
			products: 'id, name',
			lists: 'id, status',
			sections: 'id, list_id',
			stores: 'id',
			listItems: 'id, list_id, product_id, section_id, store_id, completed',
			meals: 'id, name',
			mealProducts: 'id, meal_id, product_id',
			mealSelections: 'id, meal_id, list_id',
			changes: 'id, synced, revision',
			syncMeta: 'id',
			localPrefs: 'deviceId'
		});
	}
}

export const db = new ShoppingListDatabase();
