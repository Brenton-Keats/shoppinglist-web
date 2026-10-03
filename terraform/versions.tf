# Main stack — provider and Terraform version constraints.
#
# The landing zone (terraform/15-sandbox-ci + the Sandbox state-backend stack)
# provides the S3 state bucket, GitHub OIDC provider, and the plan/apply roles.
# This repo does not bootstrap its own identity or state bucket.

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

  # Credentials come from CI (the landing-zone Sandbox role) or your local profile.
  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Stack     = "main"
    }
  }
}
