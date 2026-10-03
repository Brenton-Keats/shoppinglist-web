import { OPERATIONS } from './config';
import type { ClientChange, EntityRecord } from './types';

/**
 * Deterministic last-write-wins conflict resolution.
 */

export interface ConflictResolution {
  winner: 'client' | 'server';
  resolvedData: Record<string, unknown>;
  reason: string;
}

export function resolveConflict(
  clientChange: ClientChange,
  serverData: EntityRecord,
): ConflictResolution {
  const clientData = clientChange.data || {};
  const clientTs =
    clientChange.timestamp ||
    (clientData.updated_at as string | undefined) ||
    null;
  const serverTs =
    (serverData.updated_at as string | undefined) ||
    (serverData.created_at as string | undefined) ||
    null;

  if (clientChange.operation === OPERATIONS.DELETE) {
    return {
      winner: 'client',
      resolvedData: clientData,
      reason: 'delete_tombstone_wins',
    };
  }

  if (serverData.deleted_at) {
    return {
      winner: 'client',
      resolvedData: clientData,
      reason: 'resurrection_after_delete',
    };
  }

  if (clientTs && serverTs) {
    const clientTime = new Date(clientTs).getTime();
    const serverTime = new Date(serverTs).getTime();

    if (clientTime > serverTime) {
      return { winner: 'client', resolvedData: clientData, reason: 'later_timestamp' };
    } else if (serverTime > clientTime) {
      return { winner: 'server', resolvedData: serverData, reason: 'later_timestamp' };
    }
  }

  return { winner: 'server', resolvedData: serverData, reason: 'default_server_wins' };
}

export function hasConflict(
  clientChange: ClientChange,
  serverData: EntityRecord | null,
): boolean {
  if (!serverData) return false;

  if (clientChange.operation === OPERATIONS.DELETE && !serverData.deleted_at) {
    return true;
  }

  if (clientChange.operation === OPERATIONS.UPDATE) {
    const clientTs =
      clientChange.timestamp ||
      (clientChange.data?.updated_at as string | undefined);
    const serverTs = serverData.updated_at as string | undefined;
    if (clientTs && serverTs) {
      return new Date(serverTs).getTime() > new Date(clientTs).getTime();
    }
  }

  return false;
}
