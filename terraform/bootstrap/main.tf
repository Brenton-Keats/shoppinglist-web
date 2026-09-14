data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

# Fetches the TLS certificate chain of the GitHub OIDC issuer so we can supply
# a thumbprint. Note: AWS no longer verifies this thumbprint for the GitHub
# provider, but the API still requires the field to be populated.
data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  state_bucket_name = var.state_bucket_name != "" ? var.state_bucket_name : "${var.project_name}-tfstate-${local.account_id}"

  github_thumbprint = data.tls_certificate.github.certificates[length(data.tls_certificate.github.certificates) - 1].sha1_fingerprint

  # ARNs the CI role is allowed to manage in the main stack. Scoped to the
  # project name prefix so the role cannot touch unrelated resources.
  dynamodb_arn = "arn:${local.partition}:dynamodb:${var.aws_region}:${local.account_id}:table/${var.project_name}-*"
  lambda_arn   = "arn:${local.partition}:lambda:${var.aws_region}:${local.account_id}:function:${var.project_name}-*"
  iam_role_arn = "arn:${local.partition}:iam::${local.account_id}:role/${var.project_name}-*"
  logs_arn     = "arn:${local.partition}:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/${var.project_name}-*"
  alarm_arn    = "arn:${local.partition}:cloudwatch:${var.aws_region}:${local.account_id}:alarm:${var.project_name}-*"
}

# ─── Terraform remote state bucket ───────────────────────────────────────────

resource "aws_s3_bucket" "tfstate" {
  bucket = local.state_bucket_name

  # Protects against accidental deletion of the state bucket.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# ─── GitHub Actions OIDC provider ────────────────────────────────────────────

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [local.github_thumbprint]
}

# ─── CI role assumed by GitHub Actions ───────────────────────────────────────

data "aws_iam_policy_document" "ci_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Restricts which repository (and by extension, branches/PRs) may assume
    # the role. The wildcard permits any ref in the repo; tighten to
    # "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/main" if you
    # want apply gated strictly to main.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_owner}/${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "ci" {
  name               = var.ci_role_name
  description        = "Assumed by GitHub Actions (OIDC) to plan/apply the ${var.project_name} main Terraform stack."
  assume_role_policy = data.aws_iam_policy_document.ci_assume_role.json
}

data "aws_iam_policy_document" "ci_permissions" {
  # Terraform remote state access.
  statement {
    sid       = "TerraformStateList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.tfstate.arn]
  }

  statement {
    sid    = "TerraformStateObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.tfstate.arn}/*"]
  }

  # DynamoDB table lifecycle for the main stack.
  statement {
    sid    = "DynamoDbTableManagement"
    effect = "Allow"
    actions = [
      "dynamodb:CreateTable",
      "dynamodb:DeleteTable",
      "dynamodb:DescribeTable",
      "dynamodb:UpdateTable",
      "dynamodb:DescribeContinuousBackups",
      "dynamodb:UpdateContinuousBackups",
      "dynamodb:DescribeTimeToLive",
      "dynamodb:UpdateTimeToLive",
      "dynamodb:ListTagsOfResource",
      "dynamodb:TagResource",
      "dynamodb:UntagResource",
    ]
    resources = [local.dynamodb_arn]
  }

  # Lambda function + Function URL lifecycle.
  statement {
    sid    = "LambdaManagement"
    effect = "Allow"
    actions = [
      "lambda:CreateFunction",
      "lambda:DeleteFunction",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:GetFunctionUrlConfig",
      "lambda:CreateFunctionUrlConfig",
      "lambda:UpdateFunctionUrlConfig",
      "lambda:DeleteFunctionUrlConfig",
      "lambda:AddPermission",
      "lambda:RemovePermission",
      "lambda:GetPolicy",
      "lambda:PutFunctionConcurrency",
      "lambda:DeleteFunctionConcurrency",
      "lambda:ListVersionsByFunction",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:ListTags",
    ]
    resources = [local.lambda_arn]
  }

  # IAM role for the Lambda execution role (created/managed by the main stack).
  statement {
    sid    = "LambdaExecRoleManagement"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:PassRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:GetRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
    ]
    resources = [local.iam_role_arn]
  }

  # CloudWatch Logs group for the Lambda.
  statement {
    sid    = "LogsManagement"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:DescribeLogGroups",
      "logs:PutRetentionPolicy",
      "logs:DeleteRetentionPolicy",
      "logs:TagResource",
      "logs:UntagResource",
      "logs:ListTagsForResource",
    ]
    resources = [local.logs_arn, "${local.logs_arn}:*"]
  }

  # Cost-control alarm for the main stack.
  statement {
    sid    = "AlarmManagement"
    effect = "Allow"
    actions = [
      "cloudwatch:PutMetricAlarm",
      "cloudwatch:DeleteAlarms",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:ListTagsForResource",
      "cloudwatch:TagResource",
      "cloudwatch:UntagResource",
    ]
    resources = [local.alarm_arn]
  }
}

resource "aws_iam_role_policy" "ci" {
  name   = "${var.project_name}-ci-permissions"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ci_permissions.json
}
