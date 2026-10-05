import type { BaseEntity } from '$lib/types';

export interface ServerChange {
	revision: number;
	entityType: string;
	entityId: string;
	operation: string;
	data: Record<string, unknown>;
	timestamp: string;
}

export function resolveConflict(
	localEntity: BaseEntity,
	serverChange: { timestamp: string; data: Record<string, unknown> }
): 'local' | 'server' {
	// Tombstones (deleted_at) always win over updates
	const serverHasTombstone = serverChange.data.deleted_at !== undefined && serverChange.data.deleted_at !== null;
	const localIsDeleted = localEntity.deleted_at !== null;

	if (serverHasTombstone && !localIsDeleted) {
		return 'server';
	}

	if (localIsDeleted && !serverHasTombstone) {
		return 'local';
	}

	// Compare updated_at timestamps. Prefer the server entity's own updated_at
	// when present (apples-to-apples with the local entity); fall back to the
	// change envelope timestamp otherwise.
	const serverUpdatedRaw =
		typeof serverChange.data.updated_at === 'string' && serverChange.data.updated_at !== ''
			? serverChange.data.updated_at
			: serverChange.timestamp;

	const localUpdatedAt = new Date(localEntity.updated_at).getTime();
	const serverUpdatedAt = new Date(serverUpdatedRaw).getTime();

	const localValid = !Number.isNaN(localUpdatedAt);
	const serverValid = !Number.isNaN(serverUpdatedAt);

	// Unparseable timestamps must not silently default to clobbering the other
	// side. Trust whichever side has a valid timestamp; if neither does, keep
	// local to avoid repeatedly overwriting on every sync.
	if (!serverValid && !localValid) return 'local';
	if (!serverValid) return 'local';
	if (!localValid) return 'server';

	if (serverUpdatedAt > localUpdatedAt) {
		return 'server';
	}

	if (localUpdatedAt > serverUpdatedAt) {
		return 'local';
	}

	// If timestamps are equal, server wins (deterministic)
	return 'server';
}
