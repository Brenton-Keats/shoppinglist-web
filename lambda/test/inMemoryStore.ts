import type { Store } from '../src/store';
import type { ChangeRecord, EntityRecord, SettingRecord } from '../src/types';

/** In-memory Store implementation used to exercise handlers without AWS. */
export class InMemoryStore implements Store {
  private entities = new Map<string, Map<string, EntityRecord>>();
  private changes: ChangeRecord[] = [];
  private settings: SettingRecord[] = [];
  private revision = 0;

  seedSetting(key: string, value: string) {
    this.settings.push({ key, value });
  }

  private table(type: string): Map<string, EntityRecord> {
    let t = this.entities.get(type);
    if (!t) {
      t = new Map();
      this.entities.set(type, t);
    }
    return t;
  }

  async getEntitiesByType(type: string): Promise<EntityRecord[]> {
    return Array.from(this.table(type).values()).map((r) => ({ ...r }));
  }

  async getEntity(type: string, id: string): Promise<EntityRecord | null> {
    const r = this.table(type).get(id);
    return r ? { ...r } : null;
  }

  async putEntity(type: string, record: EntityRecord): Promise<void> {
    this.table(type).set(record.id, { ...record });
  }

  async getSettings(): Promise<SettingRecord[]> {
    return this.settings.map((s) => ({ ...s }));
  }

  async getServerRevision(): Promise<number> {
    return this.revision;
  }

  async allocateRevisions(count: number): Promise<number> {
    this.revision += count;
    return this.revision;
  }

  async putChanges(records: ChangeRecord[]): Promise<void> {
    for (const rec of records) {
      this.changes.push({ ...rec });
    }
  }

  async getChangesSince(revision: number): Promise<ChangeRecord[]> {
    return this.changes
      .filter((c) => c.revision > revision)
      .sort((a, b) => a.revision - b.revision)
      .map((c) => ({ ...c }));
  }
}
