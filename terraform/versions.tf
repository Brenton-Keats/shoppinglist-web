# Main stack — provider and Terraform version constraints.
#
# Depends on the bootstrap stack (./bootstrap) having created the S3 state
# bucket, GitHub OIDC provider, and CI role.

terraform {
  # >= 1.11 for GA native S3 state locking (use_lockfile) — no DynamoDB lock
  # table required.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.60"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # In CI the ambient credentials are the management-account broker role (which
  # owns state access); resource operations run as the Sandbox target role via
  # assume_role. Left unset for local runs, where your own credentials are used.
  dynamic "assume_role" {
    for_each = var.deploy_role_arn != "" ? [1] : []
    content {
      role_arn = var.deploy_role_arn
    }
  }

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Stack     = "main"
    }
  }
}
