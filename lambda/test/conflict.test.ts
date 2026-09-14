import { describe, expect, it } from 'vitest';
import { hasConflict, resolveConflict } from '../src/conflict';
import type { ClientChange, EntityRecord } from '../src/types';

const server: EntityRecord = {
  id: 'a1',
  name: 'Milk',
  updated_at: '2026-08-16T10:00:00.000Z',
  created_at: '2026-08-16T09:00:00.000Z',
  deleted_at: null,
};

describe('hasConflict', () => {
  it('no server data means no conflict', () => {
    const change: ClientChange = { id: 'c1', entityType: 'Product', entityId: 'a1', operation: 'update', data: {} };
    expect(hasConflict(change, null)).toBe(false);
  });

  it('delete against a live server row is a conflict', () => {
    const change: ClientChange = { id: 'c1', entityType: 'Product', entityId: 'a1', operation: 'delete', data: {} };
    expect(hasConflict(change, server)).toBe(true);
  });

  it('update with older client timestamp conflicts', () => {
    const change: ClientChange = {
      id: 'c1', entityType: 'Product', entityId: 'a1', operation: 'update',
      data: { updated_at: '2026-08-16T09:30:00.000Z' },
    };
    expect(hasConflict(change, server)).toBe(true);
  });

  it('update with newer client timestamp does not conflict', () => {
    const change: ClientChange = {
      id: 'c1', entityType: 'Product', entityId: 'a1', operation: 'update',
      data: { updated_at: '2026-08-16T11:00:00.000Z' },
    };
    expect(hasConflict(change, server)).toBe(false);
  });
});

describe('resolveConflict', () => {
  it('delete tombstone always wins for client', () => {
    const change: ClientChange = { id: 'c1', entityType: 'Product', entityId: 'a1', operation: 'delete', data: {} };
    expect(resolveConflict(change, server).winner).toBe('client');
  });

  it('resurrection after delete favours client', () => {
    const deleted: EntityRecord = { ...server, deleted_at: '2026-08-16T10:30:00.000Z' };
    const change: ClientChange = {
      id: 'c1', entityType: 'Product', entityId: 'a1', operation: 'update',
      data: { updated_at: '2026-08-16T09:00:00.000Z' },
    };
    expect(resolveConflict(change, deleted).winner).toBe('client');
  });

  it('later client timestamp wins', () => {
    const change: ClientChange = {
      id: 'c1', entityType: 'Product', entityId: 'a1', operation: 'update',
      data: { updated_at: '2026-08-16T12:00:00.000Z' },
    };
    expect(resolveConflict(change, server).winner).toBe('client');
  });

  it('later server timestamp wins', () => {
    const change: ClientChange = {
      id: 'c1', entityType: 'Product', entityId: 'a1', operation: 'update',
      data: { updated_at: '2026-08-16T09:00:00.000Z' },
    };
    expect(resolveConflict(change, server).winner).toBe('server');
  });
});
