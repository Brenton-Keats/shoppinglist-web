# Landing Zone Access Requirements — `shoppinglist-web`

GitHub Actions assumes **LZ-provided plan/apply roles via GitHub OIDC** to manage
a small serverless stack with **S3 remote state (native lock files, no DynamoDB
lock table)**. The LZ owns the state bucket and the plan/apply roles. This
document lists exactly what those roles need and what we need back.

## Placeholders

| Token | Meaning |
|---|---|
| `ACCOUNT` | target AWS account ID |
| `REGION` | deployment region |
| `STATE_BUCKET` | LZ-owned Terraform state bucket |
| `STATE_KMS_KEY_ARN` | CMK ARN if the state bucket is SSE-KMS (omit if SSE-S3) |
| `OWNER/REPO` | this GitHub repository |
| `shoppinglist-*` | resource name prefix (`project_name`, default `shoppinglist`) |

## Resources this stack manages

- 1 DynamoDB table `shoppinglist-data` (on-demand)
- 1 Lambda function `shoppinglist-api` (`nodejs24.x`) + a **public Function URL** (`AuthType NONE`)
- 1 Lambda execution role `shoppinglist-lambda-exec` (+ inline policy)
- 1 CloudWatch log group `/aws/lambda/shoppinglist-api` + 1 metric alarm
- Terraform state objects under `s3://STATE_BUCKET/shoppinglist/*`

---

## 1. OIDC trust (both plan and apply roles)

Requires the account-level GitHub OIDC provider
`token.actions.githubusercontent.com` (audience `sts.amazonaws.com`) to exist.
Each role's trust policy must allow this repo:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike":  { "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:*" }
  }
}
```

Optional tightening (recommended): scope the **apply** role to
`repo:OWNER/REPO:ref:refs/heads/main` and the **plan** role to
`repo:OWNER/REPO:pull_request`.

---

## 2. Apply role — permissions

Scoped to the `shoppinglist-*` prefix and our state prefix:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TerraformState",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::STATE_BUCKET"
    },
    {
      "Sid": "TerraformStateObjectsAndLock",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::STATE_BUCKET/shoppinglist/*"
    },
    {
      "Sid": "DynamoDbTable",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:DescribeTable",
        "dynamodb:UpdateTable", "dynamodb:DescribeContinuousBackups",
        "dynamodb:UpdateContinuousBackups", "dynamodb:DescribeTimeToLive",
        "dynamodb:UpdateTimeToLive", "dynamodb:ListTagsOfResource",
        "dynamodb:TagResource", "dynamodb:UntagResource"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT:table/shoppinglist-*"
    },
    {
      "Sid": "Lambda",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction", "lambda:DeleteFunction", "lambda:GetFunction",
        "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration", "lambda:GetFunctionUrlConfig",
        "lambda:CreateFunctionUrlConfig", "lambda:UpdateFunctionUrlConfig",
        "lambda:DeleteFunctionUrlConfig", "lambda:AddPermission",
        "lambda:RemovePermission", "lambda:GetPolicy",
        "lambda:PutFunctionConcurrency", "lambda:DeleteFunctionConcurrency",
        "lambda:ListVersionsByFunction", "lambda:TagResource",
        "lambda:UntagResource", "lambda:ListTags"
      ],
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:shoppinglist-*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:DescribeLogGroups",
        "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy",
        "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource"
      ],
      "Resource": "arn:aws:logs:REGION:ACCOUNT:log-group:/aws/lambda/shoppinglist-*"
    },
    {
      "Sid": "Alarm",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms",
        "cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource",
        "cloudwatch:TagResource", "cloudwatch:UntagResource"
      ],
      "Resource": "arn:aws:cloudwatch:REGION:ACCOUNT:alarm:shoppinglist-*"
    },
    {
      "Sid": "Identity",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    }
  ]
}
```

If `STATE_BUCKET` is **SSE-KMS**, also add on `STATE_KMS_KEY_ARN`:
`kms:Decrypt`, `kms:GenerateDataKey`, `kms:DescribeKey`.

The Lambda IAM statements needed for the execution role depend on **Option A vs
B** in section 4 below.

---

## 3. Plan role — permissions

Same **state** access as the apply role (Terraform acquires a state lock during
plan, which writes/deletes the `.tflock` object — so it needs
`s3:PutObject`/`DeleteObject` on `shoppinglist/*` too; alternatively we can run
`terraform plan -lock=false` and you can keep this role read-only on state).

For AWS resources, the plan role only needs **read** actions (state refresh):

- `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `dynamodb:DescribeTimeToLive`, `dynamodb:ListTagsOfResource`
- `lambda:GetFunction`, `lambda:GetFunctionConfiguration`, `lambda:GetFunctionUrlConfig`, `lambda:GetPolicy`, `lambda:ListVersionsByFunction`, `lambda:ListTags`
- `iam:GetRole`, `iam:GetRolePolicy`, `iam:ListRolePolicies`, `iam:ListAttachedRolePolicies` (on `role/shoppinglist-*`)
- `logs:DescribeLogGroups`, `logs:ListTagsForResource`
- `cloudwatch:DescribeAlarms`, `cloudwatch:ListTagsForResource`
- `sts:GetCallerIdentity`

---

## 4. Lambda execution role — **pick one option**

The Lambda needs its own IAM role (assumed by `lambda.amazonaws.com`) carrying a
minimal runtime policy. Two ways to provide it:

### Option A — the apply role creates it (simplest for us)

Add to the **apply** role, scoped to `role/shoppinglist-*`:

```json
[
  {
    "Sid": "LambdaExecRole",
    "Effect": "Allow",
    "Action": [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:TagRole",
      "iam:UntagRole", "iam:PutRolePolicy", "iam:DeleteRolePolicy",
      "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy"
    ],
    "Resource": "arn:aws:iam::ACCOUNT:role/shoppinglist-*"
  },
  {
    "Sid": "PassExecRoleToLambda",
    "Effect": "Allow",
    "Action": "iam:PassRole",
    "Resource": "arn:aws:iam::ACCOUNT:role/shoppinglist-*",
    "Condition": { "StringEquals": { "iam:PassedToService": "lambda.amazonaws.com" } }
  }
]
```

If the LZ **mandates a permissions boundary** on created roles, send us the
boundary policy ARN — we'll attach it to the role we create.

### Option B — the LZ pre-creates it (if role creation is disallowed)

Create a role (e.g. `shoppinglist-lambda-exec`) and send us its ARN. It must:

- **Trust:** `lambda.amazonaws.com` (`sts:AssumeRole`).
- **Carry this permissions policy** (the only runtime access the function needs):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDbDataAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
        "dynamodb:Query", "dynamodb:BatchWriteItem"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT:table/shoppinglist-data"
    },
    {
      "Sid": "WriteLogs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:REGION:ACCOUNT:log-group:/aws/lambda/shoppinglist-api:*"
    }
  ]
}
```

With Option B, the apply role does **not** need the `iam:*`/`PassRole`
statements in Option A. We'll consume the role ARN via a Terraform variable and
skip creating it.

---

## 5. Guardrail confirmations

Please confirm none of these are blocked by SCP/guardrails:

1. **Public Lambda Function URL** (`AuthType NONE`) — the app is a static site on
   GitHub Pages that can't sign SigV4; access is gated at the app layer (shared
   key or Google ID token). If public Function URLs are disallowed, we need to
   discuss an alternative before proceeding.
2. Deployment **region** `REGION` is permitted.
3. On-demand DynamoDB, Lambda reserved concurrency, and CloudWatch alarms are
   permitted.

---

## 6. What we need back (→ GitHub Actions config)

| Item | Used as | Notes |
|---|---|---|
| Apply role ARN | variable `AWS_ROLE_ARN` | assumed on push to `main` |
| Plan role ARN | (if separate) | assumed on PRs |
| Region | variable `AWS_REGION` | |
| State bucket name | variable `TF_STATE_BUCKET` | init `-backend-config` |
| State key prefix | — | we use `shoppinglist/main.tfstate` (confirm the prefix is acceptable) |
| State KMS key ARN | — | only if the bucket is SSE-KMS |
| Permissions boundary ARN | — | only if Option A + boundary mandated |
| Lambda exec role ARN | Terraform variable | only if Option B |
| OIDC provider present + trust updated | — | confirm the trust admits `repo:OWNER/REPO` |
