# Remote state backend — landing-zone-provided S3 bucket in the Sandbox account,
# native locking (use_lockfile). Static config, so `terraform init` needs no
# -backend-config. See the landing zone's terraform/15-sandbox-ci/WORKLOAD-CI-ACCESS.md.
# Local validation without a backend:
#   terraform init -backend=false && terraform validate

terraform {
  backend "s3" {
    bucket       = "terraform-state-132848804640-ap-southeast-2-an"
    key          = "projects/shoppinglist-web/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
