import { describe, it, expect } from 'vitest';
import { normalizeEntity, normalizeArray } from '$lib/db/normalize';

describe('normalizeEntity', () => {
	it('converts empty string deleted_at to null', () => {
		const result = normalizeEntity({ id: '1', name: 'Test', deleted_at: '' });
		expect(result.deleted_at).toBeNull();
	});

	it('converts empty string archived_at to null', () => {
		const result = normalizeEntity({ id: '1', archived_at: '' });
		expect(result.archived_at).toBeNull();
	});

	it('preserves valid timestamp in deleted_at', () => {
		const result = normalizeEntity({ id: '1', deleted_at: '2026-01-01T00:00:00Z' });
		expect(result.deleted_at).toBe('2026-01-01T00:00:00Z');
	});

	it('preserves null deleted_at', () => {
		const result = normalizeEntity({ id: '1', deleted_at: null });
		expect(result.deleted_at).toBeNull();
	});

	it('converts empty string section_id to null', () => {
		const result = normalizeEntity({ id: '1', section_id: '' });
		expect(result.section_id).toBeNull();
	});

	it('converts empty string store_id to null', () => {
		const result = normalizeEntity({ id: '1', store_id: '' });
		expect(result.store_id).toBeNull();
	});

	it('preserves valid section_id', () => {
		const result = normalizeEntity({ id: '1', section_id: 'abc-123' });
		expect(result.section_id).toBe('abc-123');
	});

	it('coerces string "TRUE" to boolean true for active field', () => {
		const result = normalizeEntity({ id: '1', active: 'TRUE' });
		expect(result.active).toBe(true);
	});

	it('coerces string "FALSE" to boolean false for active field', () => {
		const result = normalizeEntity({ id: '1', active: 'FALSE' });
		expect(result.active).toBe(false);
	});

	it('preserves boolean true for active field', () => {
		const result = normalizeEntity({ id: '1', active: true });
		expect(result.active).toBe(true);
	});

	it('coerces string "true" (lowercase) for completed field', () => {
		const result = normalizeEntity({ id: '1', completed: 'true' });
		expect(result.completed).toBe(true);
	});

	it('preserves a fractional-indexing string sort_order key', () => {
		const result = normalizeEntity({ id: '1', sort_order: 'a3' });
		expect(result.sort_order).toBe('a3');
	});

	it('falls back to the default key when sort_order is empty', () => {
		expect(normalizeEntity({ id: '1', sort_order: '' }).sort_order).toBe('a0');
	});

	it('does not modify fields not in the normalization lists', () => {
		const result = normalizeEntity({ id: '1', name: 'Milk', status: 'ACTIVE' });
		expect(result.name).toBe('Milk');
		expect(result.status).toBe('ACTIVE');
	});

	it('handles a complete Store entity with legacy string-typed fields', () => {
		const raw = {
			id: 'store-1',
			name: 'Coles',
			sort_order: '2',
			active: 'TRUE',
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			deleted_at: ''
		};
		const result = normalizeEntity(raw);
		expect(result).toEqual({
			id: 'store-1',
			name: 'Coles',
			sort_order: '2',
			active: true,
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			deleted_at: null
		});
	});

	it('handles a complete ListItem entity with legacy string-typed fields', () => {
		const raw = {
			id: 'item-1',
			list_id: 'list-1',
			product_id: 'prod-1',
			name_snapshot: 'Milk',
			section_id: '',
			store_id: '',
			quantity: '',
			unit: '',
			completed: 'FALSE',
			completed_at: '',
			sort_order: '1',
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			deleted_at: ''
		};
		const result = normalizeEntity(raw);
		expect(result.section_id).toBeNull();
		expect(result.store_id).toBeNull();
		expect(result.quantity).toBeNull();
		expect(result.unit).toBeNull();
		expect(result.completed).toBe(false);
		expect(result.completed_at).toBeNull();
		expect(result.sort_order).toBe('1');
		expect(result.deleted_at).toBeNull();
	});
});

describe('normalizeArray', () => {
	it('normalizes all items in the array', () => {
		const raw = [
			{ id: 'a', deleted_at: '', active: 'TRUE', sort_order: '1' },
			{ id: 'b', deleted_at: '', active: 'FALSE', sort_order: '2' }
		];
		const result = normalizeArray(raw);
		expect(result).toHaveLength(2);
		expect(result[0].deleted_at).toBeNull();
		expect(result[0].active).toBe(true);
		expect(result[1].active).toBe(false);
	});

	it('filters out items without id', () => {
		const raw = [
			{ id: 'a', name: 'Good' },
			{ id: '', name: 'Empty' },
			{ name: 'Missing' } as any
		];
		const result = normalizeArray(raw);
		expect(result).toHaveLength(1);
	});

	it('filters out null items', () => {
		const raw = [{ id: 'a' }, null, undefined] as any[];
		const result = normalizeArray(raw);
		expect(result).toHaveLength(1);
	});
});
