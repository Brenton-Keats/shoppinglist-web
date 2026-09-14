# Remote state backend — S3 with native locking (no DynamoDB lock table).
#
# The bucket name embeds the AWS account ID (see bootstrap), which isn't known
# at authoring time, so `bucket` and `region` are supplied at init via partial
# backend configuration:
#
#   terraform init \
#     -backend-config="bucket=shoppinglist-tfstate-<account_id>" \
#     -backend-config="region=<your-region>"
#
# CI passes these from the bootstrap outputs. For local runs, use a backend
# config file (backend.hcl, gitignored) — see README.md.
#
# For local validation without any backend, run:
#   terraform init -backend=false && terraform validate

terraform {
  backend "s3" {
    key          = "shoppinglist/main.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
