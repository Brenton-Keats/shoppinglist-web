import { ENTITY_COLUMNS, OPERATIONS } from './config';
import { coerceFieldValue, normalizeFields } from './normalize';
import type { EntityRecord, EntityType, Operation } from './types';
import type { Store } from './store';

/** Resolve a column from already-normalized data, else coerce the fallback. */
function resolveColumn(
  col: string,
  data: Record<string, unknown>,
  fallback: unknown,
): unknown {
  if (data[col] !== undefined) return data[col];
  return coerceFieldValue(col, fallback);
}

/**
 * Pure computation of the row to write for a create/update/delete.
 *
 * The backend enforces the column type scheme: incoming `data` and any values
 * carried over from an existing row are coerced to their canonical types
 * (dates → ISO string or null, booleans/numbers coerced) so the persisted row
 * is always well-formed, no matter what the client sent.
 *
 * Returns the record to upsert, or null when the operation is a no-op (e.g.
 * deleting an entity that doesn't exist).
 */
export function computeEntityWrite(
  columns: string[],
  entityId: string,
  operation: string,
  rawData: Record<string, unknown>,
  existing: EntityRecord | null,
  now: string,
): EntityRecord | null {
  const data = normalizeFields(rawData);

  if (operation === OPERATIONS.CREATE || (operation === OPERATIONS.UPDATE && !existing)) {
    const record: Record<string, unknown> = {};
    for (const col of columns) {
      if (col === 'id') {
        record[col] = entityId;
      } else if (col === 'created_at') {
        // Honour a valid client-supplied created_at; otherwise server clock.
        record[col] = coerceCreatedAt(data[col], now);
      } else if (col === 'updated_at') {
        record[col] = now;
      } else if (col === 'active' || col === 'completed') {
        record[col] = data[col] !== undefined ? data[col] : col === 'active';
      } else {
        record[col] = data[col] !== undefined ? data[col] : coerceFieldValue(col, null);
      }
    }
    return record as EntityRecord;
  }

  if (operation === OPERATIONS.UPDATE) {
    const record: Record<string, unknown> = {};
    for (const col of columns) {
      if (col === 'updated_at') {
        record[col] = now;
      } else {
        record[col] = resolveColumn(col, data, existing![col] ?? null);
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
        record[col] = coerceFieldValue(col, existing[col] ?? null);
      }
    }
    return record as EntityRecord;
  }

  return null;
}

/** created_at: keep a valid ISO value from the client, else use the server clock. */
function coerceCreatedAt(value: unknown, now: string): string {
  const coerced = coerceFieldValueCreatedAt(value);
  return coerced ?? now;
}

function coerceFieldValueCreatedAt(value: unknown): string | null {
  if (typeof value === 'string' && value !== '' && !Number.isNaN(new Date(value).getTime())) {
    return value;
  }
  return null;
}

/**
 * Applies a single change to the store. Returns the canonical record that was
 * written (so callers can log it as the change-log payload), or null when the
 * operation was a no-op (e.g. deleting a row that doesn't exist, or an unknown
 * entity type).
 */
export async function applyChange(
  store: Store,
  entityType: string,
  entityId: string,
  operation: string,
  data: Record<string, unknown>,
  now: string = new Date().toISOString(),
): Promise<EntityRecord | null> {
  const columns = ENTITY_COLUMNS[entityType as EntityType];
  if (!columns) {
    return null;
  }

  const existing = await store.getEntity(entityType, entityId);
  const record = computeEntityWrite(columns, entityId, operation, data, existing, now);
  if (!record) {
    return null;
  }

  await store.putEntity(entityType, record);
  return record;
}
