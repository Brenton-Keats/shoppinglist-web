output "state_bucket_name" {
  description = "Name of the S3 bucket holding Terraform remote state. Use this in the main stack's backend configuration."
  value       = aws_s3_bucket.tfstate.bucket
}

output "state_bucket_region" {
  description = "Region of the state bucket (matches aws_region)."
  value       = var.aws_region
}

output "ci_role_arn" {
  description = "ARN of the IAM role GitHub Actions assumes via OIDC. Set as the AWS_ROLE_ARN GitHub Actions variable/secret."
  value       = aws_iam_role.ci.arn
}

output "oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "account_id" {
  description = "AWS account ID the bootstrap was applied to."
  value       = local.account_id
}
