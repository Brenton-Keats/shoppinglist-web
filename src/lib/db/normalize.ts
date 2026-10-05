/**
 * Data normalization layer.
 *
 * Transforms raw server data into canonical TypeScript types.
 * Applied ONCE at the ingestion boundary (when data enters IndexedDB).
 * After normalization, all internal code can trust the TypeScript interfaces.
 *
 * The Lambda + DynamoDB backend now enforces this same type scheme on write
 * (see lambda/src/normalize.ts), so canonical data is the norm. This client
 * layer remains as defense-in-depth: it guards against any legacy rows written
 * before that enforcement existed, and keeps the ingestion contract explicit.
 *
 * Rules:
 * - Empty strings → null (for nullable fields like deleted_at, archived_at)
 * - "TRUE"/"FALSE" strings → boolean (for active, completed)
 * - Numeric strings → number (for sort_order, quantity)
 * - Already-correct types pass through unchanged
 */

/** Fields that should be null when empty */
const NULLABLE_FIELDS = new Set([
	'deleted_at',
	'archived_at',
	'started_at',
	'completed_at',
	'default_section_id',
	'default_store_id',
	'section_id',
	'store_id',
	'product_id',
	'list_id',
	'unit',
	'quantity'
]);

/** Fields that should be boolean */
const BOOLEAN_FIELDS = new Set(['active', 'completed', 'synced']);

/** Fields that should be number. sort_order is intentionally excluded: it is a
 * fractional-indexing STRING key (see utils/ordering), not a number. */
const NUMBER_FIELDS = new Set(['revision', 'quantity']);

/** Fallback fractional-indexing key for rows missing a usable sort_order. */
const DEFAULT_SORT_KEY = 'a0';

/**
 * Normalize a single entity record from the server response to canonical types.
 */
export function normalizeEntity<T extends Record<string, unknown>>(raw: T): T {
	const result = { ...raw };

	for (const [key, value] of Object.entries(result)) {
		// sort_order: a fractional-indexing string key. Keep non-empty strings;
		// fall back to a default key when empty/missing.
		if (key === 'sort_order') {
			if (typeof value !== 'string' || value.length === 0) {
				(result as Record<string, unknown>)[key] = DEFAULT_SORT_KEY;
			}
			continue;
		}

		// Nullable fields: empty string → null
		if (NULLABLE_FIELDS.has(key) && (value === '' || value === undefined)) {
			(result as Record<string, unknown>)[key] = null;
			continue;
		}

		// Boolean fields: coerce strings and numbers
		if (BOOLEAN_FIELDS.has(key)) {
			if (typeof value === 'string') {
				(result as Record<string, unknown>)[key] = value.toLowerCase() === 'true';
			} else if (typeof value === 'number') {
				(result as Record<string, unknown>)[key] = value !== 0;
			}
			continue;
		}

		// Number fields: coerce strings
		if (NUMBER_FIELDS.has(key) && typeof value === 'string') {
			const num = Number(value);
			(result as Record<string, unknown>)[key] = isNaN(num) ? 0 : num;
			continue;
		}
	}

	return result;
}

/**
 * Normalize an array of entities, also filtering out items without a valid id.
 * Includes JSON round-trip to strip reactive proxies and non-cloneable values.
 */
export function normalizeArray<T extends Record<string, unknown>>(items: T[]): T[] {
	// First: strip proxies/non-cloneables via JSON round-trip
	const plain: T[] = JSON.parse(JSON.stringify(items));
	// Then: filter and normalize types
	return plain
		.filter((item) => item && (item as Record<string, unknown>).id)
		.map(normalizeEntity);
}
