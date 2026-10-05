# Shopping List — Lambda backend

TypeScript AWS Lambda that serves the sync API for the PWA. Two endpoints:

- `GET`  → full dataset dump
- `POST` → batched sync

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
allocation and the current server revision, and is updated atomically.

## Curating the data directly (AWS console / CLI)

Sometimes you need to inspect or fix data outside the app — e.g. remove a stray
list, correct a typo, or audit what the server holds. The data lives in a single
DynamoDB table; you can edit it with the AWS console or the CLI.

**Table name:** `shoppinglist-data` (pattern `<project_name>-data`; the exact
name is the Terraform output `table_name`).
**Region:** `ap-southeast-2` (the `aws_region` variable).

> Read the four caveats at the end of this section **before** writing. Direct
> edits bypass the sync protocol, so getting them wrong can desync every client.

### Finding the table name and region

```bash
terraform -chdir=terraform output -raw table_name   # e.g. shoppinglist-data
AWS_REGION=ap-southeast-2
TABLE=$(terraform -chdir=terraform output -raw table_name)
```

### Key layout recap

Every item has a String `pk` and `sk`:

| Item             | pk              | sk                     |
|------------------|-----------------|------------------------|
| Entity           | `ENTITY#<Type>` | `<id>` (UUID)          |
| Change log       | `CHANGELOG`     | zero-padded revision   |
| Revision counter | `META`          | `serverRevision`       |
| Setting          | `SETTING`       | `<key>`                |

`<Type>` is one of `List`, `Section`, `Store`, `Product`, `ListItem`.

### Reading

**Console:** DynamoDB → Tables → `shoppinglist-data` → *Explore table items*.
Use *Query* with a partition key such as `ENTITY#List` to list all lists, or
*Scan* with a filter to search by a field like `name`.

**CLI — all entities of a type** (e.g. all lists):

```bash
aws dynamodb query --region "$AWS_REGION" --table-name "$TABLE" \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"ENTITY#List"}}'
```

**CLI — one entity by id:**

```bash
aws dynamodb get-item --region "$AWS_REGION" --table-name "$TABLE" \
  --key '{"pk":{"S":"ENTITY#ListItem"},"sk":{"S":"<item-uuid>"}}'
```

**CLI — the current server revision:**

```bash
aws dynamodb get-item --region "$AWS_REGION" --table-name "$TABLE" \
  --key '{"pk":{"S":"META"},"sk":{"S":"serverRevision"}}'
```

### Updating a field

Prefer the console for one-off edits: open the item, edit the attribute, and
**bump `updated_at`** to a current ISO-8601 timestamp so clients treat your edit
as the newest write (last-write-wins compares `updated_at`).

CLI equivalent (rename a store, stamping `updated_at`):

```bash
aws dynamodb update-item --region "$AWS_REGION" --table-name "$TABLE" \
  --key '{"pk":{"S":"ENTITY#Store"},"sk":{"S":"<store-uuid>"}}' \
  --update-expression "SET #n = :name, updated_at = :now" \
  --expression-attribute-names '{"#n":"name"}' \
  --expression-attribute-values '{":name":{"S":"Coles Express"},":now":{"S":"2026-10-05T00:00:00.000Z"}}'
```

Keep values well-typed to match the scheme the Lambda enforces (`src/normalize.ts`):
dates are ISO-8601 strings or absent/null, `active`/`completed` are booleans,
`sort_order`/`quantity` are numbers.

### Deleting

There are two kinds of delete — pick deliberately:

- **Soft delete (recommended):** set `deleted_at` to an ISO timestamp and bump
  `updated_at`. The row stays as a tombstone; clients hide it and, crucially,
  propagate the deletion through sync. This is what the app itself does.

  ```bash
  aws dynamodb update-item --region "$AWS_REGION" --table-name "$TABLE" \
    --key '{"pk":{"S":"ENTITY#List"},"sk":{"S":"<list-uuid>"}}' \
    --update-expression "SET deleted_at = :now, updated_at = :now" \
    --expression-attribute-values '{":now":{"S":"2026-10-05T00:00:00.000Z"}}'
  ```

- **Hard delete (rare):** physically remove the row. Use only to purge data
  that must never reach any client (e.g. accidental junk). Clients that already
  hold the row will **not** learn it is gone.

  ```bash
  aws dynamodb delete-item --region "$AWS_REGION" --table-name "$TABLE" \
    --key '{"pk":{"S":"ENTITY#List"},"sk":{"S":"<list-uuid>"}}'
  ```

### Caveats (read before writing)

1. **Direct edits bypass the change log.** `GET /api/data` reflects your edit
   immediately, but incremental sync (`POST /api/sync`) only returns rows newer
   than a client's `baseRevision` via the `CHANGELOG`. A console/CLI edit writes
   no changelog entry, so devices doing incremental sync won't see it until they
   do a full re-fetch. For a change you want pushed to all devices promptly,
   prefer making it in the app.
2. **Always bump `updated_at`** on an edit. Conflict resolution is last-write-
   wins on `updated_at`; a stale timestamp means the next client sync can
   overwrite your edit.
3. **Never hand-edit `META`/`serverRevision`.** It is an atomic counter the
   Lambda owns. Changing it can corrupt revision allocation and break sync for
   every client.
4. **Honour the type scheme.** Empty strings for dates, string booleans, or
   non-numeric `sort_order` are the exact malformed shapes the backend now
   guards against — don't reintroduce them by hand.

A repo-level script for bulk curation does not exist yet; if one is added it
belongs in `scripts/` and should reuse the key layout and type rules above.

## Conflict handling

Create/update/delete field handling (`src/apply.ts`) and last-write-wins
conflict resolution (`src/conflict.ts`): delete tombstones win,
resurrection-after-delete favours the client, otherwise later `updated_at` wins
with the server as the tiebreak.

## Auth

`src/auth.ts` defines a pluggable `Authenticator`. The deployment uses
`src/googleAuth.ts` — Google ID-token verification (`node:crypto` + JWKS,
`aud`/`iss`/`exp` checks, optional email allowlist) — selected when
`GOOGLE_CLIENT_ID` is set. A shared-API-key authenticator remains available as a
fallback for setups without Google configured.

## Layout

```
src/
  index.ts        Lambda entrypoint: event parsing, routing, response shaping
  handlers.ts     handleGetData / handlePostSync (the contract)
  apply.ts        entity write computation (create/update/delete)
  conflict.ts     LWW conflict resolution
  store.ts        storage interface
  dynamoStore.ts  DynamoDB implementation
  auth.ts         pluggable authentication interface + shared-key fallback
  googleAuth.ts   Google ID-token verification (JWKS, aud/iss/exp, allowlist)
  config.ts       entity columns, key layout, revision padding
  types.ts        shared types
test/             vitest suite (in-memory Store; no AWS needed)
```

## Commands

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (in-memory, no AWS)
npm run build       # tsc -> dist/  (packaged by Terraform)
```

## Runtime

- Runtime: `nodejs24.x`
- Handler: `index.handler`
- Env vars: `TABLE_NAME` (required); `GOOGLE_CLIENT_ID` + `ALLOWED_EMAILS`
  (Google auth); `API_KEY` (optional shared-key fallback)
- The AWS SDK v3 is provided by the Lambda runtime, so `dist/` ships without
  `node_modules`. SDK packages are dev/build-time dependencies here.
