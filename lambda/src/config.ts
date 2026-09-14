import type { EntityType } from './types';

/**
 * Per-entity column definitions, mirroring SHEET_HEADERS in
 * apps-script/Config.ts. These drive create/update/delete field handling so
 * behaviour matches the original backend exactly.
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
