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

State and CI identity are provided by the landing zone. The full contract and how
the identity works live in the landing-zone repo at
`terraform/15-sandbox-ci/WORKLOAD-CI-ACCESS.md`. What this repo consumes:

- **State:** S3 bucket `terraform-state-132848804640-ap-southeast-2-an`, key
  `projects/shoppinglist-web/terraform.tfstate` (static in `backend.tf` — no
  `-backend-config` needed).
- **CI roles:** the Sandbox `GitHubActionsTerraformPlan` / `GitHubActionsTerraformApply`
  roles, assumed through the `terraform-plan` / `terraform-apply` GitHub
  environments (see the workflow).
- **Auth:** Google-auth mode is required — set `google_client_id` and
  `allowed_emails` (Terraform) and `PUBLIC_GOOGLE_CLIENT_ID` (frontend). A shared
  key is not acceptable for this account.

## Prerequisites

- Terraform `>= 1.11` (native S3 locking via `use_lockfile`).
- Lambda build present: run `npm ci && npm run build` in `../lambda` so
  `../lambda/dist` exists (CI does this automatically).
- For local runs: credentials for the Sandbox account (e.g. assume
  `OrganizationAccountAccessRole`, or an SSO profile) with access to the state
  bucket and the resources being managed.

## Local usage

```bash
cd terraform

# Variables (Google auth for this account).
cp terraform.tfvars.example terraform.tfvars   # edit google_client_id, allowed_emails, allowed_origins

# Backend is static — no -backend-config needed. Uses your ambient Sandbox creds.
terraform init
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

- CI uses the landing-zone Sandbox roles; local runs use your own Sandbox
  credentials.
- CORS `allow_origins` must include your exact Pages origin
  (e.g. `https://<user>.github.io`) — the path/base is not part of the origin.
- Enabling DynamoDB point-in-time recovery or a TTL on change-log items are
  noted as future options in `main.tf`.
