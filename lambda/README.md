# Shopping List — Lambda backend

TypeScript AWS Lambda that replaces the Google Apps Script backend. It exposes
the **same two-endpoint contract** the frontend already speaks, so the client
change at cutover is minimal:

- `GET`  → full dataset dump (was `GET /api/data`)
- `POST` → batched sync (was `POST /api/sync`)

Routing is by HTTP method (the client distinguishes data vs sync by GET/POST,
not by path). The function is invoked through a **Lambda Function URL**; CORS and
OPTIONS preflight are handled by the Function URL configuration (Terraform), not
in code.

## DynamoDB single-table design

One table, uniform String `pk`/`sk`:

| Item            | pk               | sk                       | Notes |
|-----------------|------------------|--------------------------|-------|
| Entity          | `ENTITY#<Type>`  | `<id>`                   | One row per List/Section/Store/Product/ListItem, incl. soft-deleted tombstones |
| Change log      | `CHANGELOG`      | zero-padded revision     | `Query pk=CHANGELOG AND sk > <base>` returns changes since a revision |
| Revision counter| `META`           | `serverRevision`         | `value` (Number); atomic `ADD` allocates revisions |
| Setting         | `SETTING`        | `<key>`                  | `value` (String) |

Revisions are zero-padded to a fixed width so lexicographic SK ordering equals
numeric ordering. The counter is the single source of truth for both revision
allocation and the current server revision, and is updated atomically — correct
even without the reserved-concurrency=1 guard the deployment also applies.

## Behaviour parity

The create/update/delete field handling (`src/apply.ts`) and last-write-wins
conflict resolution (`src/conflict.ts`) are ported from
`apps-script/ChangeLog.ts` and `apps-script/Conflict.ts` so results match the
Sheets backend: delete tombstones win, resurrection-after-delete favours the
client, otherwise later `updated_at` wins with server as the tiebreak.

## Auth

`src/auth.ts` is a pluggable `Authenticator`. Phase 1 ships the shared-API-key
scheme (query `?key=` or body `apiKey`), matching the current model. Phase 5
swaps in Google ID-token verification without touching the handlers.

## Layout

```
src/
  index.ts        Lambda entrypoint: event parsing, routing, response shaping
  handlers.ts     handleGetData / handlePostSync (the contract)
  apply.ts        entity write computation (create/update/delete)
  conflict.ts     LWW conflict resolution
  store.ts        storage interface
  dynamoStore.ts  DynamoDB implementation
  auth.ts         pluggable authentication
  config.ts       entity columns, key layout, revision padding
  types.ts        shared types
test/             vitest suite (in-memory Store; no AWS needed)
```

## Commands

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (26 tests, in-memory)
npm run build       # tsc -> dist/  (packaged by Terraform)
```

## Data migration (one-off)

`scripts/migrate.mjs` copies the existing Google Apps Script dataset into
DynamoDB. Run it once after the main Terraform stack is applied and before
cutting the frontend over:

```bash
cd lambda
npm ci   # ensures the AWS SDK is available to the script

SOURCE_URL="https://script.google.com/macros/s/XXX/exec" \
SOURCE_API_KEY="the-shared-key" \
TABLE_NAME="$(terraform -chdir=../terraform output -raw table_name)" \
AWS_REGION="ap-southeast-2" \
npm run migrate -- --dry-run     # inspect counts first, then drop --dry-run
```

It upserts all entities + settings and seeds the revision counter to the
source `serverRevision` (idempotent — safe to re-run). The change-log history is
**not** migrated, so make sure every device is fully synced before cutover;
a device that was behind should clear its local data to trigger a fresh initial
fetch. AWS credentials come from the standard SDK credential chain.

## Runtime

- Runtime: `nodejs24.x`
- Handler: `index.handler`
- Env vars: `TABLE_NAME` (required), `API_KEY` (optional; omit for open access)
- The AWS SDK v3 is provided by the Lambda runtime, so `dist/` ships without
  `node_modules`. SDK packages are dev/build-time dependencies here.
