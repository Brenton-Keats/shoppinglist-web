import { ENTITY_COLUMNS, OPERATIONS } from './config';
import type { EntityRecord, EntityType, Operation } from './types';
import type { Store } from './store';

/**
 * Pure computation of the row to write for a create/update/delete, mirroring
 * applyEntityChange() in apps-script/ChangeLog.ts.
 *
 * Returns the record to upsert, or null when the operation is a no-op (e.g.
 * deleting an entity that doesn't exist).
 */
export function computeEntityWrite(
  columns: string[],
  entityId: string,
  operation: string,
  data: Record<string, unknown>,
  existing: EntityRecord | null,
  now: string,
): EntityRecord | null {
  if (operation === OPERATIONS.CREATE || (operation === OPERATIONS.UPDATE && !existing)) {
    const record: Record<string, unknown> = {};
    for (const col of columns) {
      if (col === 'id') {
        record[col] = entityId;
      } else if (col === 'created_at') {
        record[col] = data[col] ?? now;
      } else if (col === 'updated_at') {
        record[col] = now;
      } else if (col === 'active' || col === 'completed') {
        record[col] = data[col] !== undefined ? data[col] : col === 'active';
      } else {
        record[col] = data[col] !== undefined ? data[col] : null;
      }
    }
    return record as EntityRecord;
  }

  if (operation === OPERATIONS.UPDATE) {
    const record: Record<string, unknown> = {};
    for (const col of columns) {
      if (col === 'updated_at') {
        record[col] = now;
      } else if (data[col] !== undefined) {
        record[col] = data[col];
      } else {
        record[col] = existing![col] ?? null;
      }
    }
    return record as EntityRecord;
  }

  if (operation === OPERATIONS.DELETE) {
    if (!existing) return null;
    const record: Record<string, unknown> = {};
    for (const col of columns) {
      if (col === 'deleted_at' || col === 'updated_at') {
        record[col] = now;
      } else {
        record[col] = existing[col] ?? null;
      }
    }
    return record as EntityRecord;
  }

  return null;
}

/**
 * Applies a single change to the store. Returns true if a write occurred.
 * Mirrors applyChange() in apps-script/ChangeLog.ts.
 */
export async function applyChange(
  store: Store,
  entityType: string,
  entityId: string,
  operation: string,
  data: Record<string, unknown>,
  now: string = new Date().toISOString(),
): Promise<boolean> {
  const columns = ENTITY_COLUMNS[entityType as EntityType];
  if (!columns) {
    return false;
  }

  const existing = await store.getEntity(entityType, entityId);
  const record = computeEntityWrite(columns, entityId, operation, data, existing, now);
  if (!record) {
    return false;
  }

  await store.putEntity(entityType, record);
  return true;
}
