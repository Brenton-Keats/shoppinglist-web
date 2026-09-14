import type { ChangeRecord, EntityRecord, SettingRecord } from './types';

/**
 * Storage abstraction over the single DynamoDB table.
 *
 * Handlers depend only on this interface, which lets the full sync contract be
 * exercised in-memory (see test/) without any AWS dependency. DynamoStore is
 * the production implementation; InMemoryStore is the test double.
 */
export interface Store {
  /** All rows of one entity type, including soft-deleted tombstones. */
  getEntitiesByType(type: string): Promise<EntityRecord[]>;

  /** Single entity by type + id, or null if absent. */
  getEntity(type: string, id: string): Promise<EntityRecord | null>;

  /** Upsert a single entity row. */
  putEntity(type: string, record: EntityRecord): Promise<void>;

  /** All settings key/value pairs. */
  getSettings(): Promise<SettingRecord[]>;

  /** Current server revision (the change-log high-water mark). */
  getServerRevision(): Promise<number>;

  /**
   * Atomically reserve `count` revision numbers. Returns the highest revision
   * in the reserved block; the block is [return - count + 1 .. return].
   * Safe under concurrency (single atomic counter update).
   */
  allocateRevisions(count: number): Promise<number>;

  /** Persist change-log records (already assigned revisions). */
  putChanges(records: ChangeRecord[]): Promise<void>;

  /** Change-log records with revision strictly greater than `revision`. */
  getChangesSince(revision: number): Promise<ChangeRecord[]>;
}
