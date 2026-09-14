import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { KEYS, padRevision } from './config';
import type { Store } from './store';
import type { ChangeRecord, EntityRecord, SettingRecord } from './types';

function stripKeys<T extends Record<string, unknown>>(item: T): Omit<T, 'pk' | 'sk'> {
  const { pk, sk, ...rest } = item;
  void pk;
  void sk;
  return rest;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * DynamoDB single-table implementation of Store (see config.ts for the key
 * layout). Uses the lib-dynamodb document client so items are plain JS objects.
 */
export class DynamoStore implements Store {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  private async queryAll(pk: string, extra: Partial<QueryCommand['input']> = {}) {
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const res = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: extra.KeyConditionExpression ?? 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': pk,
            ...(extra.ExpressionAttributeValues ?? {}),
          },
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of res.Items ?? []) {
        items.push(item as Record<string, unknown>);
      }
      lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items;
  }

  async getEntitiesByType(type: string): Promise<EntityRecord[]> {
    const items = await this.queryAll(KEYS.entityPk(type));
    return items.map((it) => stripKeys(it) as EntityRecord);
  }

  async getEntity(type: string, id: string): Promise<EntityRecord | null> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: KEYS.entityPk(type), sk: id },
      }),
    );
    if (!res.Item) return null;
    return stripKeys(res.Item as Record<string, unknown>) as EntityRecord;
  }

  async putEntity(type: string, record: EntityRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk: KEYS.entityPk(type), sk: record.id, ...record },
      }),
    );
  }

  async getSettings(): Promise<SettingRecord[]> {
    const items = await this.queryAll(KEYS.SETTING_PK);
    return items.map((it) => ({
      key: String(it.sk),
      value: it.value === undefined || it.value === null ? '' : String(it.value),
    }));
  }

  async getServerRevision(): Promise<number> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: KEYS.META_PK, sk: KEYS.REVISION_SK },
      }),
    );
    const value = res.Item?.value;
    return typeof value === 'number' ? value : Number(value) || 0;
  }

  async allocateRevisions(count: number): Promise<number> {
    const res = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: KEYS.META_PK, sk: KEYS.REVISION_SK },
        UpdateExpression: 'ADD #v :count',
        ExpressionAttributeNames: { '#v': 'value' },
        ExpressionAttributeValues: { ':count': count },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    const value = res.Attributes?.value;
    return typeof value === 'number' ? value : Number(value) || 0;
  }

  async putChanges(records: ChangeRecord[]): Promise<void> {
    for (const group of chunk(records, 25)) {
      await this.client.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: group.map((rec) => ({
              PutRequest: {
                Item: {
                  pk: KEYS.CHANGELOG_PK,
                  sk: padRevision(rec.revision),
                  ...rec,
                },
              },
            })),
          },
        }),
      );
    }
  }

  async getChangesSince(revision: number): Promise<ChangeRecord[]> {
    const items = await this.queryAll(KEYS.CHANGELOG_PK, {
      KeyConditionExpression: 'pk = :pk AND sk > :sk',
      ExpressionAttributeValues: { ':sk': padRevision(revision) },
    });
    return items.map((it) => {
      const rec = stripKeys(it) as unknown as ChangeRecord;
      rec.revision = typeof rec.revision === 'number' ? rec.revision : Number(rec.revision);
      return rec;
    });
  }
}
