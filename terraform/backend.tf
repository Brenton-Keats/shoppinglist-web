# Remote state backend — landing-zone-owned S3 bucket, native locking.
#
# The state bucket lives in the management account (029678959044), and state
# read/write + lock access belongs to the GitHub broker roles. CI authenticates
# as the broker (ambient credentials), so the S3 backend uses those broker
# credentials directly. Resource operations use the Sandbox target role via the
# provider's assume_role (see versions.tf) — the plan target role is read-only,
# which is why state access rides on the broker, not the target.
#
# Static config (values fixed by the LZ), so `terraform init` needs no
# -backend-config. For local validation without a backend:
#   terraform init -backend=false && terraform validate

terraform {
  backend "s3" {
    bucket       = "terraform-state-029678959044-ap-southeast-2-an"
    key          = "projects/shoppinglist-web/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
