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

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Stack     = "main"
    }
  }
}
