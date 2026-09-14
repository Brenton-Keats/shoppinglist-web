# Bootstrap stack — provider and Terraform version constraints.
#
# This stack is applied ONCE, manually, with LOCAL state (see backend note
# below). It provisions the resources that the main stack's remote state
# backend and CI pipeline depend on, so it cannot itself use that backend.

terraform {
  # Native S3 state locking (use_lockfile) requires >= 1.11 in the main stack.
  # We keep the same floor here for consistency, even though bootstrap uses
  # local state.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.60"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.1"
    }
  }

  # Intentionally NO backend block: bootstrap uses local state. The state file
  # (terraform.tfstate) is gitignored. Bootstrap is idempotent and rarely run,
  # so local state is acceptable and avoids a chicken-and-egg dependency on the
  # very bucket this stack creates.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}
