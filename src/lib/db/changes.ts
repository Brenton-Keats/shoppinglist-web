import { db } from './database';
import { serialize } from './serialize';
import { getOrCreateDeviceId } from '$lib/utils/id';
import { generateUUID, now } from './utils';
import type { ChangeRecord } from '$lib/types';

/**
 * Record a change for sync. Coalesces with existing unsynced changes
 * for the same entity to reduce sync payload:
 *
 * - create + update → single "create" with merged payload
 * - update + update → single "update" with merged payload
 * - any + delete → single "delete"
 * - create + delete → both removed (entity never existed on server)
 */
export async function recordChange(
	entityType: ChangeRecord['entity_type'],
	entityId: string,
	operation: ChangeRecord['operation'],
	payload: Record<string, unknown>
): Promise<ChangeRecord> {
	const deviceId = getOrCreateDeviceId();
	const cleanPayload = serialize(payload);

	// Look for an existing unsynced change for the same entity
	const existing = await db.changes
		.filter((c) => c.entity_id === entityId && c.entity_type === entityType && c.synced === false)
		.first();

	if (existing) {
		// Coalesce based on operation combination
		if (operation === 'delete') {
			if (existing.operation === 'create') {
				// Created then deleted locally — cancel both out
				await db.changes.delete(existing.id);
				// Return a dummy record (won't be synced)
				return { ...existing, operation: 'delete', payload: {} };
			}
			// Update then delete, or delete then delete — just keep the delete
			await db.changes.update(existing.id, {
				operation: 'delete',
				payload: {},
				timestamp: now()
			});
			return { ...existing, operation: 'delete', payload: {} };
		}

		if (operation === 'update') {
			// Merge update payload into existing change
			const mergedPayload = { ...existing.payload, ...cleanPayload };
			await db.changes.update(existing.id, {
				payload: serialize(mergedPayload),
				timestamp: now()
			});
			return { ...existing, payload: mergedPayload };
		}

		// operation === 'create' but one already exists — shouldn't happen, but overwrite
		await db.changes.update(existing.id, {
			operation: 'create',
			payload: cleanPayload,
			timestamp: now()
		});
		return { ...existing, operation: 'create', payload: cleanPayload };
	}

	// No existing change — create a new one
	const change: ChangeRecord = {
		id: generateUUID(),
		revision: null,
		timestamp: now(),
		device_id: deviceId,
		entity_type: entityType,
		entity_id: entityId,
		operation,
		payload: cleanPayload,
		synced: false
	};

	await db.changes.add(change);
	return change;
}

export async function markChangesSynced(changeIds: string[], revision: number): Promise<void> {
	await db.changes.bulkUpdate(
		changeIds.map((id) => ({
			key: id,
			changes: {
				synced: true,
				revision
			}
		}))
	);
}

export async function removeSyncedChanges(): Promise<number> {
	// `synced` is stored as a BOOLEAN (see recordChange / markChangesSynced), so
	// `.where('synced').equals(1)` (integer) never matched — the same class of
	// bug as the pending-count query (Item 1). Filter on the boolean directly.
	const syncedChanges = await db.changes.filter((c) => c.synced === true).toArray();
	const ids = syncedChanges.map((c) => c.id);
	await db.changes.bulkDelete(ids);
	return ids.length;
}
