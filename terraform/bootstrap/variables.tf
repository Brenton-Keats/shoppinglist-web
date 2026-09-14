variable "aws_region" {
  description = "AWS region for all resources. Placeholder — set to your account's region."
  type        = string
  default     = "ap-southeast-2"
}

variable "project_name" {
  description = "Short project identifier used to name and tag resources."
  type        = string
  default     = "shoppinglist"
}

variable "github_owner" {
  description = "GitHub organisation or user that owns the repository. PLACEHOLDER — override before applying."
  type        = string
  default     = "CHANGEME-github-owner"
}

variable "github_repo" {
  description = "GitHub repository name (without owner)."
  type        = string
  default     = "shoppinglist-web"
}

variable "state_bucket_name" {
  description = <<-EOT
    Globally-unique S3 bucket name for Terraform remote state. If left empty,
    a name is derived as "<project_name>-tfstate-<account_id>", which is
    unique per AWS account. Override only if you need a specific name.
  EOT
  type        = string
  default     = ""
}

variable "ci_role_name" {
  description = "Name of the IAM role assumed by GitHub Actions via OIDC."
  type        = string
  default     = "shoppinglist-ci"
}
