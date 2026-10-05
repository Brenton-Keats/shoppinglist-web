import { db } from '$lib/db/database';
import { getEntityById, softDeleteEntity } from '$lib/db/operations';
import { markChangesSynced } from '$lib/db/changes';
import { normalizeArray, normalizeEntity } from '$lib/db/normalize';
import { getPendingChanges } from '$lib/db/queries';
import { getOrCreateDeviceId } from '$lib/utils/id';
import { fetchServerData, submitChanges } from './api';
import { syncStateStore } from './state.svelte';
import { resolveConflict, type ServerChange } from './conflict';
import { UNAUTHENTICATED } from '$lib/auth';
import type { BaseEntity } from '$lib/types';

/**
 * Maps a caught sync error to the appropriate sync state. "Not signed in" is a
 * normal condition (unauthenticated), not an error.
 */
function reportSyncFailure(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	const type = (error as { type?: string } | null)?.type;
	if (message === UNAUTHENTICATED || type === 'auth') {
		syncStateStore.setUnauthenticated();
	} else {
		syncStateStore.setError(message);
	}
}

const ENTITY_TABLE_MAP: Record<string, string> = {
	List: 'lists',
	Section: 'sections',
	Store: 'stores',
	Product: 'products',
	ListItem: 'listItems'
};

async function getSyncMeta(): Promise<{ lastRevision: number | null; deviceId: string }> {
	const meta = await db.syncMeta.get('main');
	return {
		lastRevision: meta?.lastRevision ?? null,
		deviceId: getOrCreateDeviceId()
	};
}

async function updateSyncMeta(lastRevision: number, lastSyncTime: string): Promise<void> {
	await db.syncMeta.put({
		id: 'main',
		lastRevision,
		lastSyncTime
	});
}

function mapEntityTypeToTable(entityType: string): string | undefined {
	return ENTITY_TABLE_MAP[entityType];
}

export async function applyServerChanges(serverChanges: ServerChange[]): Promise<void> {
	const sorted = [...serverChanges].sort((a, b) => a.revision - b.revision);

	for (const change of sorted) {
		const table = mapEntityTypeToTable(change.entityType);
		if (!table) {
			console.warn(`Unknown entity type: ${change.entityType}`);
			continue;
		}

		const localEntity = await getEntityById<BaseEntity>(table, change.entityId);

		if (change.operation === 'delete') {
			if (localEntity) {
				await softDeleteEntity(table, change.entityId);
			}
			continue;
		}

		// Normalize server data at the ingestion boundary, exactly as the full
		// fetch path does (fetchInitialData → normalizeArray). This converts
		// empty-string dates to null, coerces boolean/number fields, and strips
		// reactive proxies, so downstream code (conflict comparison, grouping,
		// date formatting) can trust the canonical TypeScript types.
		const normalized = normalizeEntity({
			...change.data,
			id: change.entityId
		}) as BaseEntity;

		if (change.operation === 'create') {
			if (localEntity) {
				const winner = resolveConflict(localEntity, {
					timestamp: change.timestamp,
					data: change.data
				});
				if (winner === 'server') {
					await db.table(table).put(normalized);
				}
			} else {
				await db.table(table).add(normalized);
			}
			continue;
		}

		if (change.operation === 'update') {
			if (localEntity) {
				const winner = resolveConflict(localEntity, {
					timestamp: change.timestamp,
					data: change.data
				});
				if (winner === 'server') {
					await db.table(table).update(change.entityId, normalized as Record<string, unknown>);
				}
			} else {
				await db.table(table).add(normalized);
			}
			continue;
		}

		console.warn(`Unknown operation: ${change.operation}`);
	}
}

/**
 * Perform an incremental sync via POST /api/sync.
 *
 * Always sends baseRevision. If there are pending local changes, they're
 * included. The server returns changes since baseRevision.
 *
 * Returns true if remote data was received (caller should refresh UI).
 * Returns false if no new data (no UI refresh needed).
 */
export async function performSync(): Promise<boolean> {
	syncStateStore.setSyncing();

	try {
		if (!navigator.onLine) {
			syncStateStore.setOffline();
			return false;
		}

		const { lastRevision, deviceId } = await getSyncMeta();
		const pendingChanges = await getPendingChanges();

		const changesPayload = pendingChanges.map((change) => ({
			id: change.id,
			entityType: change.entity_type,
			entityId: change.entity_id,
			operation: change.operation,
			data: change.payload
		}));

		const baseRevision = lastRevision ?? 0;

		const response = await submitChanges({
			deviceId,
			baseRevision,
			changes: changesPayload
		});

		if (!response.success) {
			syncStateStore.setError('Server rejected sync request');
			return false;
		}

		let dataChanged = false;

		// Apply any server-side changes we haven't seen yet
		if (response.changes.length > 0) {
			// Map server response format (snake_case) to client format (camelCase)
			const mappedChanges = response.changes.map((c: Record<string, unknown>) => ({
				revision: c.revision ?? c['revision'],
				entityType: c.entityType ?? c['entity_type'],
				entityId: c.entityId ?? c['entity_id'],
				operation: c.operation,
				data: c.data ?? c['payload'] ?? {},
				timestamp: c.timestamp
			}));
			await applyServerChanges(mappedChanges);
			dataChanged = true;
			syncStateStore.dataVersion++;
		}

		// Mark our submitted changes as synced
		if (response.acceptedChanges.length > 0) {
			await markChangesSynced(response.acceptedChanges, response.serverRevision);
		}

		const syncTime = new Date().toISOString();
		await updateSyncMeta(response.serverRevision, syncTime);
		syncStateStore.setLastSyncTime(new Date(syncTime));
		syncStateStore.setServerRevision(response.serverRevision);
		await syncStateStore.refreshPendingCount();
		syncStateStore.setIdle();

		return dataChanged;
	} catch (error) {
		reportSyncFailure(error);
		return false;
	}
}

/**
 * Full initial data fetch for fresh clients (no syncMeta).
 * Clears local DB and pulls everything from the server via GET /api/data.
 * Always returns true (data was loaded).
 */
export async function fetchInitialData(): Promise<boolean> {
	syncStateStore.setSyncing();

	try {
		if (!navigator.onLine) {
			syncStateStore.setOffline();
			return false;
		}

		const data = await fetchServerData();

		await db.transaction(
			'rw',
			[db.lists, db.sections, db.stores, db.products, db.listItems, db.syncMeta],
			async () => {
				await db.lists.clear();
				await db.sections.clear();
				await db.stores.clear();
				await db.products.clear();
				await db.listItems.clear();

				const lists = normalizeArray(data.lists);
				const sections = normalizeArray(data.sections);
				const stores = normalizeArray(data.stores);
				const products = normalizeArray(data.products);
				const listItems = normalizeArray(data.listItems);

				if (lists.length > 0) await db.lists.bulkPut(lists);
				if (sections.length > 0) await db.sections.bulkPut(sections);
				if (stores.length > 0) await db.stores.bulkPut(stores);
				if (products.length > 0) await db.products.bulkPut(products);
				if (listItems.length > 0) await db.listItems.bulkPut(listItems);

				const now = new Date().toISOString();
				await db.syncMeta.put({
					id: 'main',
					lastRevision: data.serverRevision,
					lastSyncTime: now
				});
			}
		);

		syncStateStore.setLastSyncTime(new Date());
		syncStateStore.setServerRevision(data.serverRevision);
		syncStateStore.dataVersion++;
		await syncStateStore.refreshPendingCount();
		syncStateStore.setIdle();

		return true;
	} catch (error) {
		reportSyncFailure(error);
		return false;
	}
}
