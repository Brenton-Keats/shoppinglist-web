# Terraform — main stack

Provisions the runtime infrastructure for the Shopping List backend:

- **DynamoDB** single table (on-demand billing) — see `../lambda/README.md` for the key layout.
- **Lambda** function (`nodejs24.x`, handler `index.handler`) packaged from `../lambda/dist`.
- **Lambda Function URL** (auth `NONE`, CORS for the GitHub Pages origin).
- **Least-privilege execution role**, **CloudWatch log group** (short retention),
  and a **cost-safety invocation alarm**.
- **reserved_concurrent_executions = 1** — serializes execution (matches the
  original single-threaded backend the sync logic assumes) and caps cost.

Depends on the **bootstrap** stack (`./bootstrap`) for the S3 state bucket,
GitHub OIDC provider, and CI role.

## Prerequisites

- Terraform `>= 1.11` (native S3 locking via `use_lockfile`).
- Bootstrap stack applied; note its `state_bucket_name` and `account_id` outputs.
- Lambda build present: run `npm ci && npm run build` in `../lambda` so
  `../lambda/dist` exists (CI does this automatically).

## Local usage

```bash
cd terraform

# 1. Backend config (bucket embeds the account ID — partial config).
cp backend.hcl.example backend.hcl        # edit bucket + region
terraform init -backend-config=backend.hcl

# 2. Variables.
cp terraform.tfvars.example terraform.tfvars   # edit api_key, allowed_origins

# 3. Plan / apply.
terraform plan
terraform apply
```

After apply, wire the frontend:

```bash
terraform output function_url   # -> GitHub Actions variable PUBLIC_API_BASE_URL
```

## Validation without AWS

```bash
terraform init -backend=false
terraform validate
terraform fmt -check -recursive
```

## Notes

- `api_key = ""` means open access (matches the Apps Script setup phase). Set a
  real key, and put the same value in the frontend build's `PUBLIC_API_KEY`.
- CORS `allow_origins` must include your exact Pages origin
  (e.g. `https://<user>.github.io`) — the path/base is not part of the origin.
- Enabling DynamoDB point-in-time recovery or a TTL on change-log items are
  noted as future options in `main.tf`.
