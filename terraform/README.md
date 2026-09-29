# Terraform — main stack

Provisions the runtime infrastructure for the Shopping List backend:

- **DynamoDB** single table (on-demand billing) — see `../lambda/README.md` for the key layout.
- **Lambda** function (`nodejs24.x`, handler `index.handler`) packaged from `../lambda/dist`.
- **Lambda Function URL** (auth `NONE`, CORS for the GitHub Pages origin) + public-invoke permission.
- **Least-privilege execution role**, **CloudWatch log group** (short retention),
  and a **cost-safety invocation alarm**.
- **reserved_concurrent_executions = 1** — serializes execution (matches the
  original single-threaded backend the sync logic assumes) and caps cost.

## Landing zone integration

State and CI identity are owned by the landing zone (see `../LZ-ACCESS-DECISION.md`):

- **State:** LZ-owned S3 bucket `terraform-state-029678959044-ap-southeast-2-an`,
  key `projects/shoppinglist-web/terraform.tfstate`, SSE-S3, native lock file.
  The bucket lives in the management account; state access belongs to the GitHub
  **broker** roles, so `backend.tf` is fully static and CI runs with broker
  credentials.
- **Identity:** GitHub OIDC → management broker role → Sandbox target role. The
  AWS provider `assume_role`s the Sandbox target (`var.deploy_role_arn`) for
  resource operations, while state uses the ambient broker credentials. CI sets
  `TF_VAR_deploy_role_arn` per job (see `../.github/workflows/terraform.yml`).
- **Auth:** the LZ requires server-side Google ID-token validation for the public
  Function URL, so deploy in **Google-auth mode**: set `google_client_id` and
  `allowed_emails` (Terraform) and `PUBLIC_GOOGLE_CLIENT_ID` (frontend). The
  shared-key mode is not acceptable for this account.

## Prerequisites

- Terraform `>= 1.11` (native S3 locking via `use_lockfile`).
- Lambda build present: run `npm ci && npm run build` in `../lambda` so
  `../lambda/dist` exists (CI does this automatically).
- AWS credentials with access to the target Sandbox role (for local runs).

## Local usage

```bash
cd terraform

# Variables (Google auth for this account).
cp terraform.tfvars.example terraform.tfvars   # edit google_client_id, allowed_emails, allowed_origins

# Backend is static — no -backend-config needed. Uses your ambient AWS creds.
terraform init
terraform plan     # optionally: -var="deploy_role_arn=arn:aws:iam::132848804640:role/TerraformShoppingListWebApply"
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

- `deploy_role_arn` is empty by default (local runs use your own credentials);
  CI sets it to the plan/apply Sandbox target role.
- CORS `allow_origins` must include your exact Pages origin
  (e.g. `https://<user>.github.io`) — the path/base is not part of the origin.
- Enabling DynamoDB point-in-time recovery or a TTL on change-log items are
  noted as future options in `main.tf`.
