import { randomUUID } from 'node:crypto';
import { applyChange } from './apply';
import { hasConflict, resolveConflict } from './conflict';
import type { Store } from './store';
import type {
  ChangeRecord,
  ClientChange,
  ConflictReport,
  ServerDataResponse,
  SyncRequest,
  SyncResponse,
} from './types';

/**
 * GET /api/data — full dataset dump for initial sync.
 */
export async function handleGetData(store: Store): Promise<ServerDataResponse> {
  const [serverRevision, lists, sections, stores, products, listItems, settings] =
    await Promise.all([
      store.getServerRevision(),
      store.getEntitiesByType('List'),
      store.getEntitiesByType('Section'),
      store.getEntitiesByType('Store'),
      store.getEntitiesByType('Product'),
      store.getEntitiesByType('ListItem'),
      store.getSettings(),
    ]);

  return { serverRevision, lists, sections, stores, products, listItems, settings };
}

/**
 * POST /api/sync — apply batched client changes, return server changes since
 * the client's base revision.
 */
export async function handlePostSync(store: Store, body: SyncRequest): Promise<SyncResponse> {
  const deviceId = body.deviceId || 'unknown';
  const baseRevision = body.baseRevision || 0;
  const clientChanges: ClientChange[] = body.changes || [];

  const acceptedIds: string[] = [];
  /** Accepted changes paired with the canonical record the server wrote. */
  const accepted: Array<{ change: ClientChange; record: Record<string, unknown> }> = [];
  const conflicts: ConflictReport[] = [];

  const now = new Date().toISOString();

  for (const change of clientChanges) {
    const serverData = await store.getEntity(change.entityType, change.entityId);

    if (hasConflict(change, serverData)) {
      const resolution = resolveConflict(change, serverData!);
      if (resolution.winner === 'client') {
        const record = await applyChange(
          store,
          change.entityType,
          change.entityId,
          change.operation,
          change.data || {},
          now,
        );
        if (record) {
          accepted.push({ change, record });
          acceptedIds.push(change.id);
        }
      }
      conflicts.push({
        changeId: change.id,
        entityType: change.entityType,
        entityId: change.entityId,
        resolution: resolution.winner,
        reason: resolution.reason,
      });
    } else {
      const record = await applyChange(
        store,
        change.entityType,
        change.entityId,
        change.operation,
        change.data || {},
        now,
      );
      if (record) {
        accepted.push({ change, record });
        acceptedIds.push(change.id);
      }
    }
  }

  // Assign revisions and persist the change log in one batch. The payload is
  // the canonical record the server actually wrote (type-enforced), NOT the raw
  // client data — so devices pulling the change log receive complete,
  // well-formed entities whose updated_at matches the stored row.
  if (accepted.length > 0) {
    const lastRevision = await store.allocateRevisions(accepted.length);
    const startRevision = lastRevision - accepted.length + 1;
    const logTimestamp = new Date().toISOString();

    const records: ChangeRecord[] = accepted.map(({ change, record }, i) => ({
      revision: startRevision + i,
      id: randomUUID(),
      timestamp: logTimestamp,
      device_id: deviceId,
      entity_type: change.entityType,
      entity_id: change.entityId,
      operation: change.operation,
      payload: record,
    }));

    await store.putChanges(records);
  }

  const finalRevision = await store.getServerRevision();

  let serverChanges: ChangeRecord[] = [];
  if (baseRevision < finalRevision) {
    serverChanges = await store.getChangesSince(baseRevision);
  }

  const response: SyncResponse = {
    success: true,
    serverRevision: finalRevision,
    acceptedChanges: acceptedIds,
    changes: serverChanges,
  };

  if (conflicts.length > 0) {
    response.conflicts = conflicts;
  }

  return response;
}
