# Terraform Bootstrap

One-time setup that provisions the resources the **main** stack (`../`) and CI
depend on:

- **S3 bucket** for Terraform remote state (versioned, encrypted, private).
- **GitHub Actions OIDC provider** so CI can assume AWS roles without long-lived keys.
- **CI IAM role** (`shoppinglist-ci`) scoped to manage only the main stack's resources.

This stack uses **local state** on purpose — it creates the very bucket the main
stack stores its state in, so it cannot use that bucket itself. The local
`terraform.tfstate` here is gitignored.

## Prerequisites

- Terraform `>= 1.11`
- AWS credentials with permissions to create S3 buckets, IAM roles, and OIDC
  providers (run this once as an admin/you, not via CI).

## Usage

```bash
cd terraform/bootstrap

# Provide your real values. github_owner MUST be overridden.
terraform init
terraform apply \
  -var="aws_region=<your-region>" \
  -var="github_owner=<your-github-user-or-org>"
```

Then note the outputs:

```bash
terraform output ci_role_arn        # -> set as GitHub Actions variable AWS_ROLE_ARN
terraform output state_bucket_name  # -> used in ../backend.tf
terraform output state_bucket_region
```

## After applying

1. Put `ci_role_arn` into the repo's GitHub Actions **variables** as `AWS_ROLE_ARN`.
2. Confirm `state_bucket_name` matches the `bucket` value in `../backend.tf`
   (the main stack). If you used the derived default name
   (`shoppinglist-tfstate-<account_id>`), update `../backend.tf` accordingly.

## Notes

- The CI trust policy allows any ref in `github_owner/github_repo` to assume the
  role. To gate `apply` strictly to `main`, tighten the `sub` condition in
  `main.tf` (a comment marks the spot).
- The state bucket has `prevent_destroy = true`. To intentionally tear it down,
  remove that lifecycle block first.
