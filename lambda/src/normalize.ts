import {
  BOOLEAN_FIELDS,
  DATE_FIELDS,
  DEFAULT_SORT_KEY,
  NULLABLE_STRING_FIELDS,
  NUMBER_FIELDS,
  SORT_KEY_FIELD,
} from './config';

/**
 * Server-side type enforcement for entity field values.
 *
 * The sync backend is the authority on the data contract: it coerces every
 * incoming value to the canonical type for its column before persisting, so
 * stored rows and the change log are always well-formed regardless of what a
 * client sends. Clients are expected to adhere to the scheme; this layer makes
 * non-adherence harmless rather than corrupting.
 */

/** True for a parseable ISO-8601 date string. */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time);
}

/**
 * Coerce a single field value to the type implied by its column name.
 * Columns not covered by any type set are returned unchanged.
 */
export function coerceFieldValue(key: string, value: unknown): unknown {
  // sort_order: fractional-indexing string key. Keep non-empty strings; fall
  // back to the default key when empty/missing.
  if (key === SORT_KEY_FIELD) {
    return typeof value === 'string' && value.length > 0 ? value : DEFAULT_SORT_KEY;
  }

  // Date columns: valid ISO string stays; everything else (""/undefined/junk) → null.
  if (DATE_FIELDS.has(key)) {
    return isValidISODate(value) ? value : null;
  }

  // Boolean columns: accept real booleans, "true"/"false" strings, 0/1.
  if (BOOLEAN_FIELDS.has(key)) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    if (typeof value === 'number') return value !== 0;
    return false;
  }

  // Number columns: accept numbers and numeric strings. The only numeric column
  // is quantity, which is nullable — junk/empty values become null.
  if (NUMBER_FIELDS.has(key)) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    }
    return null;
  }

  // Nullable string / foreign-key columns: empty string → null.
  if (NULLABLE_STRING_FIELDS.has(key)) {
    return value === '' || value === undefined ? null : value;
  }

  return value;
}

/**
 * Coerce a whole record (in place on a shallow copy) to the canonical scheme.
 * Only touches keys present on the record; callers that need defaults for
 * absent columns (create) handle those separately.
 */
export function normalizeFields<T extends Record<string, unknown>>(record: T): T {
  const result: Record<string, unknown> = { ...record };
  for (const [key, value] of Object.entries(result)) {
    result[key] = coerceFieldValue(key, value);
  }
  return result as T;
}
