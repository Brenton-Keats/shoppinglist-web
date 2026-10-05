import type { EntityType } from './types';

/**
 * Per-entity column definitions that drive create/update/delete field handling.
 */
export const ENTITY_COLUMNS: Record<EntityType, string[]> = {
  List: [
    'id', 'name', 'status', 'sort_order', 'created_at', 'updated_at',
    'started_at', 'archived_at', 'deleted_at',
  ],
  Section: [
    'id', 'list_id', 'name', 'sort_order', 'active', 'created_at',
    'updated_at', 'deleted_at',
  ],
  Store: [
    'id', 'name', 'sort_order', 'active', 'created_at', 'updated_at',
    'deleted_at',
  ],
  Product: [
    'id', 'name', 'default_section_id', 'default_store_id', 'active',
    'created_at', 'updated_at', 'deleted_at',
  ],
  ListItem: [
    'id', 'list_id', 'product_id', 'name_snapshot', 'section_id', 'store_id',
    'quantity', 'unit', 'completed', 'completed_at', 'sort_order',
    'created_at', 'updated_at', 'deleted_at',
  ],
};

export const ENTITY_TYPES: EntityType[] = [
  'List', 'Section', 'Store', 'Product', 'ListItem',
];

/**
 * Column type scheme the backend enforces on every write. The client is
 * expected to adhere to this; the server coerces/validates incoming values to
 * these types so that stored rows and the change log are always canonical.
 *
 * - DATE_FIELDS: ISO-8601 string or null. Empty strings and unparseable values
 *   become null (created_at/updated_at are handled separately by the server
 *   clock in apply.ts, so they are intentionally NOT listed here).
 * - BOOLEAN_FIELDS: real booleans. "true"/"false" strings and 0/1 are coerced.
 * - NUMBER_FIELDS: finite numbers. Numeric strings are coerced; junk → null
 *   (quantity is nullable; sort_order falls back to 0 — see normalize.ts).
 * - STRING_FIELDS that are nullable: empty string → null.
 */
export const DATE_FIELDS = new Set<string>([
  'started_at',
  'archived_at',
  'completed_at',
  'deleted_at',
]);

export const BOOLEAN_FIELDS = new Set<string>(['active', 'completed']);

export const NUMBER_FIELDS = new Set<string>(['sort_order', 'quantity']);

/** Nullable foreign-key / string columns: empty string normalises to null. */
export const NULLABLE_STRING_FIELDS = new Set<string>([
  'list_id',
  'product_id',
  'section_id',
  'store_id',
  'default_section_id',
  'default_store_id',
  'unit',
]);

export const OPERATIONS = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;

/**
 * DynamoDB single-table key helpers.
 *
 * Layout (uniform String PK/SK):
 *   Entity          pk = "ENTITY#<Type>"  sk = "<id>"
 *   Change log      pk = "CHANGELOG"       sk = <zero-padded revision>
 *   Revision counter pk = "META"           sk = "serverRevision"   (attr: value=Number)
 *   Setting         pk = "SETTING"         sk = "<key>"            (attr: value=String)
 */
export const KEYS = {
  entityPk: (type: string) => `ENTITY#${type}`,
  CHANGELOG_PK: 'CHANGELOG',
  META_PK: 'META',
  REVISION_SK: 'serverRevision',
  SETTING_PK: 'SETTING',
} as const;

/** Fixed width so lexicographic sort of the changelog SK matches numeric order. */
export const REVISION_PAD_WIDTH = 20;

export function padRevision(revision: number): string {
  return String(revision).padStart(REVISION_PAD_WIDTH, '0');
}
