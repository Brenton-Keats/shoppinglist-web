import { describe, expect, it } from 'vitest';
import { handleGetData, handlePostSync } from '../src/handlers';
import { InMemoryStore } from './inMemoryStore';
import type { SyncRequest } from '../src/types';

function createChange(overrides: Partial<import('../src/types').ClientChange> = {}) {
  return {
    id: 'chg-' + Math.random().toString(36).slice(2),
    entityType: 'List',
    entityId: 'list-1',
    operation: 'create',
    data: { name: 'Weekly Shopping', status: 'ACTIVE', updated_at: '2026-08-16T10:00:00.000Z' },
    ...overrides,
  };
}

describe('sync flow', () => {
  it('empty store returns revision 0 and empty collections', async () => {
    const store = new InMemoryStore();
    const data = await handleGetData(store);
    expect(data.serverRevision).toBe(0);
    expect(data.lists).toEqual([]);
    expect(data.listItems).toEqual([]);
  });

  it('creates an entity, bumps revision, and returns it on GET', async () => {
    const store = new InMemoryStore();
    const change = createChange();
    const res = await handlePostSync(store, { deviceId: 'dev-a', baseRevision: 0, changes: [change] });

    expect(res.success).toBe(true);
    expect(res.acceptedChanges).toEqual([change.id]);
    expect(res.serverRevision).toBe(1);
    // The submitting device is at baseRevision 0, so it receives the change back.
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0].entity_type).toBe('List');
    expect(res.changes[0].entity_id).toBe('list-1');

    const data = await handleGetData(store);
    expect(data.lists).toHaveLength(1);
    expect(data.lists[0].name).toBe('Weekly Shopping');
    expect(data.lists[0].deleted_at).toBeNull();
    expect(data.serverRevision).toBe(1);
  });

  it('second device pulls changes since its base revision', async () => {
    const store = new InMemoryStore();
    await handlePostSync(store, { deviceId: 'dev-a', baseRevision: 0, changes: [createChange()] });

    // Device B was already at revision 1 and submits nothing.
    const resUpToDate = await handlePostSync(store, { deviceId: 'dev-b', baseRevision: 1, changes: [] });
    expect(resUpToDate.changes).toHaveLength(0);
    expect(resUpToDate.serverRevision).toBe(1);

    // A third change arrives from A; B (base 1) should then see exactly it.
    await handlePostSync(store, {
      deviceId: 'dev-a', baseRevision: 1,
      changes: [createChange({ entityId: 'list-2', data: { name: 'Party', status: 'DRAFT', updated_at: '2026-08-16T11:00:00.000Z' } })],
    });
    const resB = await handlePostSync(store, { deviceId: 'dev-b', baseRevision: 1, changes: [] });
    expect(resB.changes.map((c) => c.entity_id)).toEqual(['list-2']);
    expect(resB.serverRevision).toBe(2);
  });

  it('records a conflict when client update is stale, server wins (no write)', async () => {
    const store = new InMemoryStore();
    // Seed a server row updated at 10:00.
    await handlePostSync(store, {
      deviceId: 'dev-a', baseRevision: 0,
      changes: [createChange({ entityId: 'list-1', data: { name: 'Original', status: 'ACTIVE', updated_at: '2026-08-16T10:00:00.000Z' } })],
    });

    // Stale update at 09:00 — should conflict and server should win.
    const res = await handlePostSync(store, {
      deviceId: 'dev-b', baseRevision: 1,
      changes: [createChange({ id: 'stale', operation: 'update', entityId: 'list-1', data: { name: 'Stale', updated_at: '2026-08-16T09:00:00.000Z' } })],
    });

    expect(res.conflicts).toBeDefined();
    expect(res.conflicts![0].resolution).toBe('server');
    expect(res.acceptedChanges).not.toContain('stale');

    const data = await handleGetData(store);
    expect(data.lists[0].name).toBe('Original');
  });

  it('delete tombstone is accepted and soft-deletes the row', async () => {
    const store = new InMemoryStore();
    await handlePostSync(store, { deviceId: 'dev-a', baseRevision: 0, changes: [createChange()] });

    const req: SyncRequest = {
      deviceId: 'dev-a', baseRevision: 1,
      changes: [createChange({ id: 'del', operation: 'delete', entityId: 'list-1', data: {} })],
    };
    const res = await handlePostSync(store, req);
    expect(res.acceptedChanges).toContain('del');

    const data = await handleGetData(store);
    expect(data.lists[0].deleted_at).not.toBeNull();
  });
});
