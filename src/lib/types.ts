// Entity status types
export type ListStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type EntityStatus = 'active' | 'inactive';

// Base entity with soft delete
export interface BaseEntity {
	id: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

// Lists
export interface List extends BaseEntity {
	name: string;
	status: ListStatus;
	/** Fractional-indexing key (lexicographically sortable). See utils/ordering. */
	sort_order: string;
	started_at: string | null;
	archived_at: string | null;
}

// Sections
export interface Section extends BaseEntity {
	list_id: string | null;
	name: string;
	/** Fractional-indexing key (lexicographically sortable). See utils/ordering. */
	sort_order: string;
	active: boolean;
}

// Stores
export interface Store extends BaseEntity {
	name: string;
	/** Fractional-indexing key (lexicographically sortable). See utils/ordering. */
	sort_order: string;
	active: boolean;
}

// Products
export interface Product extends BaseEntity {
	name: string;
	default_section_id: string | null;
	default_store_id: string | null;
	/** Fractional-indexing key (lexicographically sortable). See utils/ordering. */
	sort_order: string;
	active: boolean;
}

// ListItems
export interface ListItem extends BaseEntity {
	list_id: string;
	product_id: string;
	name_snapshot: string;
	section_id: string | null;
	store_id: string | null;
	quantity: number | null;
	unit: string | null;
	completed: boolean;
	completed_at: string | null;
	/** Fractional-indexing key (lexicographically sortable). See utils/ordering. */
	sort_order: string;
}

// Meals
export interface Meal extends BaseEntity {
	name: string;
	/** Fractional-indexing key (lexicographically sortable). See utils/ordering. */
	sort_order: string;
	active: boolean;
}

// MealProducts (join row: a product with a quantity belonging to a meal)
export interface MealProduct extends BaseEntity {
	meal_id: string;
	product_id: string;
	/** Snapshot of product name so a deleted product doesn't break the meal. */
	name_snapshot: string;
	quantity: number;
}

// MealSelections (this meal is selected for this list / "week")
export interface MealSelection extends BaseEntity {
	meal_id: string;
	list_id: string;
}

// Changes (for sync)
export interface ChangeRecord {
	id: string;
	revision: number | null; // null until synced
	timestamp: string;
	device_id: string;
	entity_type:
		| 'List'
		| 'Section'
		| 'Store'
		| 'Product'
		| 'ListItem'
		| 'Meal'
		| 'MealProduct'
		| 'MealSelection';
	entity_id: string;
	operation: 'create' | 'update' | 'delete';
	payload: Record<string, unknown>;
	synced: boolean;
}

// Settings
export interface Setting {
	key: string;
	value: string;
}

// View Modes
export type ViewMode = 'STORE_SECTION' | 'SECTION_STORE';

// Sync status
export type SyncStatus =
	| 'synced'
	| 'pending'
	| 'syncing'
	| 'error'
	| 'offline'
	| 'unauthenticated';

// Local preferences
export interface LocalPreferences {
	viewMode: ViewMode;
	collapsedGroups: Record<string, boolean>;
	syncMode: 'auto' | 'manual';
	syncInterval: number; // seconds
	deviceId: string;
	theme: 'light' | 'dark' | 'auto';
}
