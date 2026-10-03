/**
 * Shared types for the Shopping List sync backend.
 *
 * The shared data contract. Field names are snake_case to match what the
 * client sends and expects.
 */

export type EntityType = 'List' | 'Section' | 'Store' | 'Product' | 'ListItem';

export type Operation = 'create' | 'update' | 'delete';

/** A single change as submitted by the client in POST /api/sync. */
export interface ClientChange {
  id: string;
  entityType: EntityType | string;
  entityId: string;
  operation: Operation | string;
  /** Entity field payload (snake_case), e.g. { name, updated_at, ... }. */
  data?: Record<string, unknown>;
  /** Optional explicit timestamp; falls back to data.updated_at. */
  timestamp?: string;
}

/** A change-log record as persisted and returned to clients. */
export interface ChangeRecord {
  revision: number;
  id: string;
  timestamp: string;
  device_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: Record<string, unknown>;
}

/** Generic entity row (snake_case fields). */
export type EntityRecord = Record<string, unknown> & {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};

export interface SettingRecord {
  key: string;
  value: string;
}

/** GET /api/data response shape. */
export interface ServerDataResponse {
  serverRevision: number;
  lists: EntityRecord[];
  sections: EntityRecord[];
  stores: EntityRecord[];
  products: EntityRecord[];
  listItems: EntityRecord[];
  settings: SettingRecord[];
}

export interface ConflictReport {
  changeId: string;
  entityType: string;
  entityId: string;
  resolution: 'client' | 'server';
  reason: string;
}

/** POST /api/sync response shape. */
export interface SyncResponse {
  success: boolean;
  serverRevision: number;
  acceptedChanges: string[];
  changes: ChangeRecord[];
  conflicts?: ConflictReport[];
}

export interface SyncRequest {
  deviceId?: string;
  baseRevision?: number;
  changes?: ClientChange[];
}
