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
