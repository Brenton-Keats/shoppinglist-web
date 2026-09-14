locals {
  function_name  = "${var.project_name}-api"
  table_name     = "${var.project_name}-data"
  exec_role_name = "${var.project_name}-lambda-exec"
  log_group_name = "/aws/lambda/${var.project_name}-api"
}

# ─── DynamoDB single-table store ─────────────────────────────────────────────
# Layout (see lambda/README.md):
#   Entity           pk=ENTITY#<Type>  sk=<id>
#   Change log       pk=CHANGELOG      sk=<zero-padded revision>
#   Revision counter pk=META           sk=serverRevision
#   Setting          pk=SETTING        sk=<key>

resource "aws_dynamodb_table" "data" {
  name         = local.table_name
  billing_mode = "PAY_PER_REQUEST" # on-demand: no idle cost, scales to zero
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  # Point-in-time recovery is off to stay within free usage. Enable for
  # continuous backups (adds cost) if the data becomes valuable.
  point_in_time_recovery {
    enabled = false
  }

  # Future option: auto-expire old change-log items by setting a `ttl` epoch
  # attribute on them and enabling TTL here.
  # ttl {
  #   attribute_name = "ttl"
  #   enabled        = false
  # }
}

# ─── Lambda package ──────────────────────────────────────────────────────────
# Zips the compiled output only (lambda/dist). CI must run the Lambda build
# before terraform plan/apply so dist/ exists. The AWS SDK v3 is provided by
# the runtime, so no node_modules are bundled.

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/dist"
  output_path = "${path.module}/.build/lambda.zip"
}

# ─── Lambda execution role (least privilege) ─────────────────────────────────

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = local.exec_role_name
  description        = "Execution role for the ${local.function_name} Lambda."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda_permissions" {
  # DynamoDB: only the operations the handler performs, scoped to the table.
  statement {
    sid    = "DynamoDbDataAccess"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
      "dynamodb:BatchWriteItem",
    ]
    resources = [aws_dynamodb_table.data.arn]
  }

  # Write logs to the function's own log group.
  statement {
    sid    = "WriteLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }
}

resource "aws_iam_role_policy" "lambda_permissions" {
  name   = "${var.project_name}-lambda-permissions"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_permissions.json
}

# ─── CloudWatch log group (managed, short retention) ─────────────────────────

resource "aws_cloudwatch_log_group" "lambda" {
  name              = local.log_group_name
  retention_in_days = var.log_retention_days
}

# ─── Lambda function ─────────────────────────────────────────────────────────

resource "aws_lambda_function" "api" {
  function_name = local.function_name
  description   = "Shopping List sync API (DynamoDB-backed)."
  role          = aws_iam_role.lambda_exec.arn
  runtime       = "nodejs24.x"
  handler       = "index.handler"

  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_seconds

  # Serializes execution to match the original single-threaded Apps Script
  # behaviour the sync/conflict logic assumes, and hard-caps cost.
  reserved_concurrent_executions = 1

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.data.name
      # Shared API key (used when GOOGLE_CLIENT_ID is empty).
      API_KEY = var.api_key
      # Google auth (takes precedence when GOOGLE_CLIENT_ID is set).
      GOOGLE_CLIENT_ID = var.google_client_id
      ALLOWED_EMAILS   = join(",", var.allowed_emails)
    }
  }

  depends_on = [
    aws_iam_role_policy.lambda_permissions,
    aws_cloudwatch_log_group.lambda,
  ]
}

# ─── Function URL (public, CORS for GitHub Pages) ────────────────────────────
# auth NONE: a static frontend can't sign SigV4, so the app-level API key (or,
# in Phase 5, a Google ID token) is the access gate. CORS + OPTIONS preflight
# are handled here by the Function URL, not in the Lambda code.

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"

  cors {
    allow_credentials = false
    allow_origins     = var.allowed_origins
    allow_methods     = ["GET", "POST"]
    allow_headers     = ["content-type", "authorization"]
    max_age           = 86400
  }
}

# ─── Cost-safety alarm ───────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "invocations" {
  alarm_name          = "${local.function_name}-invocations"
  alarm_description   = "Runaway-invocation backstop for ${local.function_name}. Reserved concurrency already caps concurrency; this catches sustained volume."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  statistic           = "Sum"
  period              = 21600 # 6 hours
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.invocation_alarm_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
  ok_actions    = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}
