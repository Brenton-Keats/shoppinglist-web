import { describe, expect, it } from 'vitest';
import { computeEntityWrite } from '../src/apply';
import { ENTITY_COLUMNS } from '../src/config';
import type { EntityRecord } from '../src/types';

const NOW = '2026-08-16T10:00:00.000Z';

describe('computeEntityWrite', () => {
  it('create fills defaults (active=true, null for absent fields, timestamps)', () => {
    const rec = computeEntityWrite(
      ENTITY_COLUMNS.Product,
      'p1',
      'create',
      { name: 'Milk' },
      null,
      NOW,
    )!;
    expect(rec.id).toBe('p1');
    expect(rec.name).toBe('Milk');
    expect(rec.active).toBe(true);
    expect(rec.default_section_id).toBeNull();
    expect(rec.created_at).toBe(NOW);
    expect(rec.updated_at).toBe(NOW);
    expect(rec.deleted_at).toBeNull();
  });

  it('create honours provided created_at and completed=false default for ListItem', () => {
    const rec = computeEntityWrite(
      ENTITY_COLUMNS.ListItem,
      'i1',
      'create',
      { list_id: 'l1', product_id: 'p1', name_snapshot: 'Milk', created_at: '2026-01-01T00:00:00.000Z' },
      null,
      NOW,
    )!;
    expect(rec.completed).toBe(false);
    expect(rec.created_at).toBe('2026-01-01T00:00:00.000Z');
    expect(rec.updated_at).toBe(NOW);
  });

  it('update merges over existing and bumps updated_at', () => {
    const existing: EntityRecord = {
      id: 'p1', name: 'Milk', active: true,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
      default_section_id: 's1', default_store_id: null, deleted_at: null,
    };
    const rec = computeEntityWrite(ENTITY_COLUMNS.Product, 'p1', 'update', { name: 'Oat Milk' }, existing, NOW)!;
    expect(rec.name).toBe('Oat Milk');
    expect(rec.default_section_id).toBe('s1'); // preserved
    expect(rec.created_at).toBe('2026-01-01T00:00:00.000Z'); // preserved
    expect(rec.updated_at).toBe(NOW); // bumped
  });

  it('update on a missing row behaves like create', () => {
    const rec = computeEntityWrite(ENTITY_COLUMNS.Store, 's1', 'update', { name: 'Coles' }, null, NOW)!;
    expect(rec.id).toBe('s1');
    expect(rec.name).toBe('Coles');
    expect(rec.created_at).toBe(NOW);
  });

  it('delete sets deleted_at and preserves other fields', () => {
    const existing: EntityRecord = {
      id: 's1', name: 'Coles', active: true, sort_order: 1,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z', deleted_at: null,
    };
    const rec = computeEntityWrite(ENTITY_COLUMNS.Store, 's1', 'delete', {}, existing, NOW)!;
    expect(rec.deleted_at).toBe(NOW);
    expect(rec.updated_at).toBe(NOW);
    expect(rec.name).toBe('Coles');
  });

  it('delete on a missing row is a no-op', () => {
    const rec = computeEntityWrite(ENTITY_COLUMNS.Store, 'nope', 'delete', {}, null, NOW);
    expect(rec).toBeNull();
  });

  describe('type-scheme enforcement', () => {
    it('coerces empty-string date fields to null on create', () => {
      const rec = computeEntityWrite(
        ENTITY_COLUMNS.List,
        'l1',
        'create',
        { name: 'Groceries', status: 'ACTIVE', started_at: '', archived_at: '', deleted_at: '' },
        null,
        NOW,
      )!;
      expect(rec.started_at).toBeNull();
      expect(rec.archived_at).toBeNull();
      expect(rec.deleted_at).toBeNull();
    });

    it('coerces invalid date strings to null on update', () => {
      const existing: EntityRecord = {
        id: 'i1', list_id: 'l1', product_id: 'p1', name_snapshot: 'Milk',
        completed: false, completed_at: null, created_at: NOW, updated_at: NOW, deleted_at: null,
      };
      const rec = computeEntityWrite(
        ENTITY_COLUMNS.ListItem,
        'i1',
        'update',
        { completed: true, completed_at: 'not-a-date' },
        existing,
        NOW,
      )!;
      expect(rec.completed).toBe(true);
      expect(rec.completed_at).toBeNull();
    });

    it('coerces "true"/"false" strings and 0/1 to booleans', () => {
      const rec = computeEntityWrite(
        ENTITY_COLUMNS.Section,
        's1',
        'create',
        { name: 'Produce', list_id: 'l1', active: 'false' },
        null,
        NOW,
      )!;
      expect(rec.active).toBe(false);
    });

    it('preserves a fractional-indexing string sort_order key', () => {
      const rec = computeEntityWrite(
        ENTITY_COLUMNS.Store,
        's1',
        'create',
        { name: 'Coles', sort_order: 'a5' },
        null,
        NOW,
      )!;
      expect(rec.sort_order).toBe('a5');
    });

    it('falls back to the default sort key when sort_order is absent or empty', () => {
      const absent = computeEntityWrite(
        ENTITY_COLUMNS.Store,
        's3',
        'create',
        { name: 'IGA' },
        null,
        NOW,
      )!;
      expect(absent.sort_order).toBe('a0');

      const empty = computeEntityWrite(
        ENTITY_COLUMNS.Store,
        's4',
        'create',
        { name: 'Aldi', sort_order: '' },
        null,
        NOW,
      )!;
      expect(empty.sort_order).toBe('a0');
    });

    it('coerces quantity numeric strings to numbers and junk to null', () => {
      const ok = computeEntityWrite(
        ENTITY_COLUMNS.ListItem,
        'i1',
        'create',
        { list_id: 'l1', product_id: 'p1', name_snapshot: 'Milk', quantity: '2' },
        null,
        NOW,
      )!;
      expect(ok.quantity).toBe(2);

      const junk = computeEntityWrite(
        ENTITY_COLUMNS.ListItem,
        'i2',
        'create',
        { list_id: 'l1', product_id: 'p1', name_snapshot: 'Eggs', quantity: 'abc' },
        null,
        NOW,
      )!;
      expect(junk.quantity).toBeNull();
    });

    it('coerces empty-string foreign keys to null', () => {
      const rec = computeEntityWrite(
        ENTITY_COLUMNS.ListItem,
        'i1',
        'create',
        { list_id: 'l1', product_id: 'p1', name_snapshot: 'Milk', section_id: '', store_id: '' },
        null,
        NOW,
      )!;
      expect(rec.section_id).toBeNull();
      expect(rec.store_id).toBeNull();
    });

    it('keeps a valid client created_at but ignores an invalid one', () => {
      const good = computeEntityWrite(
        ENTITY_COLUMNS.Product,
        'p1',
        'create',
        { name: 'Milk', created_at: '2026-01-01T00:00:00.000Z' },
        null,
        NOW,
      )!;
      expect(good.created_at).toBe('2026-01-01T00:00:00.000Z');

      const bad = computeEntityWrite(
        ENTITY_COLUMNS.Product,
        'p2',
        'create',
        { name: 'Eggs', created_at: '' },
        null,
        NOW,
      )!;
      expect(bad.created_at).toBe(NOW);
    });
  });
});
