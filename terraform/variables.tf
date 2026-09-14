variable "aws_region" {
  description = "AWS region for all resources. Must match the bootstrap region."
  type        = string
  default     = "ap-southeast-2"
}

variable "project_name" {
  description = "Short project identifier used to name and tag resources. Must match bootstrap (drives CI IAM policy resource scoping)."
  type        = string
  default     = "shoppinglist"
}

variable "api_key" {
  description = <<-EOT
    Shared API key the Lambda validates on every request. Leave empty for open
    access (matches the Apps Script behaviour during initial setup). Passed to
    the Lambda as the API_KEY environment variable. Marked sensitive.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_client_id" {
  description = <<-EOT
    Google OAuth 2.0 Web client ID. When set, the Lambda verifies Google ID
    tokens (Authorization: Bearer) against this audience instead of the shared
    API key. Leave empty to keep API-key auth.
  EOT
  type        = string
  default     = ""
}

variable "allowed_emails" {
  description = <<-EOT
    Allowlist of Google account emails permitted to access the API when Google
    auth is enabled. Fails closed: empty list rejects everyone.
  EOT
  type        = list(string)
  default     = []
}

variable "allowed_origins" {
  description = <<-EOT
    Origins permitted by the Function URL CORS config. Include the GitHub Pages
    origin and any local dev origins. Example:
    ["https://<user>.github.io", "http://localhost:5173"].
  EOT
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "lambda_memory_mb" {
  description = "Lambda memory size (MB). 256 is ample for these DynamoDB operations."
  type        = number
  default     = 256
}

variable "lambda_timeout_seconds" {
  description = "Lambda timeout (seconds). Client aborts at 30s; keep below that."
  type        = number
  default     = 15
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the Lambda log group."
  type        = number
  default     = 7
}

variable "invocation_alarm_threshold" {
  description = <<-EOT
    Cost-safety alarm: fires when Lambda invocations in a 6-hour window exceed
    this count, signalling a runaway sync loop. Reserved concurrency=1 already
    hard-caps concurrency; this is a monitoring backstop.
  EOT
  type        = number
  default     = 50000
}

variable "alarm_sns_topic_arn" {
  description = "Optional SNS topic ARN to notify when the invocation alarm fires. Empty = alarm with no action (visible in console only)."
  type        = string
  default     = ""
}
