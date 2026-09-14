output "function_url" {
  description = "Public Lambda Function URL. Set as the frontend's PUBLIC_API_BASE_URL (GitHub Actions variable)."
  value       = aws_lambda_function_url.api.function_url
}

output "function_name" {
  description = "Lambda function name."
  value       = aws_lambda_function.api.function_name
}

output "function_arn" {
  description = "Lambda function ARN."
  value       = aws_lambda_function.api.arn
}

output "table_name" {
  description = "DynamoDB table name (used by the data migration script)."
  value       = aws_dynamodb_table.data.name
}

output "table_arn" {
  description = "DynamoDB table ARN."
  value       = aws_dynamodb_table.data.arn
}
