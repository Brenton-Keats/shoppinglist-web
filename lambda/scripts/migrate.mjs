#!/usr/bin/env node
/**
 * One-off migration: Google Apps Script (Sheets) -> DynamoDB.
 *
 * Pulls the full dataset from the existing backend's GET endpoint, writes every
 * entity/setting into the DynamoDB single table, and seeds the revision counter
 * to the source's serverRevision so already-synced clients continue seamlessly.
 *
 * Idempotent: entities are upserted (BatchWrite PutRequest) and the counter is
 * set to an exact value, so re-running is safe.
 *
 * The key layout MUST match lambda/src/config.ts:
 *   Entity           pk=ENTITY#<Type>  sk=<id>
 *   Revision counter pk=META           sk=serverRevision  (attr value=Number)
 *   Setting          pk=SETTING        sk=<key>           (attr value=String)
 *
 * Usage (from the lambda/ directory):
 *   SOURCE_URL="https://script.google.com/macros/s/XXX/exec" \
 *   SOURCE_API_KEY="the-shared-key" \
 *   TABLE_NAME="shoppinglist-data" \
 *   AWS_REGION="ap-southeast-2" \
 *   node scripts/migrate.mjs [--dry-run]
 *
 * AWS credentials are taken from the standard AWS SDK credential chain
 * (env vars, shared config, SSO, etc.).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const REVISION_PAD_WIDTH = 20;
const padRevision = (rev) => String(rev).padStart(REVISION_PAD_WIDTH, '0');
const entityPk = (type) => `ENTITY#${type}`;
const CHANGELOG_PK = 'CHANGELOG';
const META_PK = 'META';
const REVISION_SK = 'serverRevision';
const SETTING_PK = 'SETTING';

// GET-response collection name -> entity type.
const COLLECTIONS = {
  lists: 'List',
  sections: 'Section',
  stores: 'Store',
  products: 'Product',
  listItems: 'ListItem',
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchSourceData(sourceUrl, apiKey) {
  const url = new URL(sourceUrl);
  if (apiKey) url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Source GET failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (data == null || typeof data !== 'object') {
    throw new Error('Source returned a non-object payload');
  }
  return data;
}

async function batchWrite(doc, tableName, items) {
  for (const group of chunk(items, 25)) {
    let request = {
      RequestItems: { [tableName]: group.map((Item) => ({ PutRequest: { Item } })) },
    };
    // Handle any unprocessed items with simple retries.
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await doc.send(new BatchWriteCommand(request));
      const unprocessed = res.UnprocessedItems?.[tableName] ?? [];
      if (unprocessed.length === 0) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      request = { RequestItems: { [tableName]: unprocessed } };
      if (attempt === 4) throw new Error('BatchWrite left unprocessed items after retries');
    }
  }
}

async function main() {
  const sourceUrl = requireEnv('SOURCE_URL');
  const sourceApiKey = process.env.SOURCE_API_KEY ?? '';
  const tableName = requireEnv('TABLE_NAME');
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const dryRun = process.argv.includes('--dry-run');

  if (!region) {
    console.error('Missing AWS_REGION (or AWS_DEFAULT_REGION).');
    process.exit(1);
  }

  console.log(`Fetching source data from ${sourceUrl} ...`);
  const data = await fetchSourceData(sourceUrl, sourceApiKey);

  const serverRevision = Number(data.serverRevision) || 0;

  // Build entity items.
  const entityItems = [];
  for (const [collection, type] of Object.entries(COLLECTIONS)) {
    const rows = Array.isArray(data[collection]) ? data[collection] : [];
    for (const row of rows) {
      if (!row || row.id === undefined || row.id === null || row.id === '') {
        console.warn(`Skipping a ${type} row without an id`);
        continue;
      }
      entityItems.push({ pk: entityPk(type), sk: String(row.id), ...row });
    }
    console.log(`  ${type}: ${rows.length} rows`);
  }

  // Build setting items.
  const settingRows = Array.isArray(data.settings) ? data.settings : [];
  const settingItems = settingRows
    .filter((s) => s && s.key !== undefined && s.key !== null && s.key !== '')
    .map((s) => ({ pk: SETTING_PK, sk: String(s.key), value: s.value ?? '' }));
  console.log(`  settings: ${settingItems.length} rows`);

  const counterItem = { pk: META_PK, sk: REVISION_SK, value: serverRevision };

  console.log(`Source serverRevision: ${serverRevision}`);
  console.log(
    `Prepared ${entityItems.length} entity items, ${settingItems.length} setting items, counter=${serverRevision}.`,
  );
  console.log(
    `Note: change-log history is NOT migrated (pk=${CHANGELOG_PK} starts empty). ` +
      `Ensure all devices are fully synced before cutover; behind devices should clear ` +
      `local data to trigger a fresh initial fetch.`,
  );

  if (dryRun) {
    console.log('--dry-run: no writes performed.');
    return;
  }

  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  console.log('Writing entities + settings ...');
  await batchWrite(doc, tableName, [...entityItems, ...settingItems]);

  console.log('Seeding revision counter ...');
  await doc.send(new PutCommand({ TableName: tableName, Item: counterItem }));

  console.log('Migration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
