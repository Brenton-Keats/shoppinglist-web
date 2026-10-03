# Security Model

The PWA frontend (GitHub Pages) talks to an AWS Lambda over a **Lambda Function
URL** with `AuthType: NONE`. A static site can't sign SigV4 requests, so the
Function URL itself is public and the **application layer** is the access gate.
The Lambda supports two interchangeable auth modes, selected by configuration.

CORS is configured on the Function URL to allow only the GitHub Pages origin
(and local dev), which constrains browser callers but is not, on its own, a
security control.

## Mode 1: Shared API key (default)

The scheme carried over from the original Apps Script backend.

### How it works

1. A random key lives in two places:
   - **Server:** Terraform variable `api_key` → Lambda env var `API_KEY`.
   - **Client:** GitHub Actions secret `API_KEY` → injected into the build as `PUBLIC_API_KEY`.
2. Every request includes the key as a `?key=` query parameter (and as an
   `apiKey` body field on POST).
3. The Lambda compares it against `API_KEY` and returns `403` on mismatch. If
   `API_KEY` is empty, access is open (for initial setup only).

### What it protects against

- Casual discovery of the endpoint URL.
- Automated scanners hitting the endpoint without the key.

### What it does NOT protect against

- A determined user can extract the key from the built JavaScript.
- The key travels in the URL/body (visible in logs, history).
- No per-user identity — all authenticated callers are equivalent.

This is acceptable for a personal/household list: low asset value, low attacker
motivation, blast radius limited to one household, trivial recovery.

## Mode 2: Google sign-in (recommended upgrade)

Enabled by setting `google_client_id` (Terraform → Lambda env `GOOGLE_CLIENT_ID`)
and `PUBLIC_GOOGLE_CLIENT_ID` (frontend). When set, it **takes precedence** over
the API key, and no shared secret is baked into the shipped JavaScript.

### How it works

1. The frontend uses Google Identity Services to obtain an **ID token** (JWT)
   for the signed-in Google account.
2. The token is sent as `Authorization: Bearer <token>`.
3. The Lambda verifies the token with no external dependencies (`node:crypto`):
   - RS256 signature against Google's published JWKS (cached per Cache-Control),
   - `iss` is Google, `aud` equals `GOOGLE_CLIENT_ID`, `exp` not passed,
   - if an `ALLOWED_EMAILS` allowlist is configured, `email_verified` is true and
     `email` is on the list.
4. Anything else returns `403`.

### Where access control lives

The gate is **"any account the OAuth client authenticates"** (`aud` must equal
our client ID). Who can obtain such a token is bounded by the OAuth client
itself:

- **Authorized JavaScript origins** — tokens for our `aud` are only issued to
  pages served from the origins registered on the client, so another site can't
  mint them.
- **Consent screen user restriction** — while the app is in **Testing** status,
  only the **test users** you add (your household accounts) can sign in. This is
  the primary access boundary.

`ALLOWED_EMAILS` is **optional** defence-in-depth: leave it empty to accept any
account the client authenticates (relying on the test-user restriction), or set
it to pin access to specific emails regardless of the consent-screen config.

> ⚠️ **Keep the OAuth app in Testing** (or restrict it to a Google Workspace
> org). If you move it to **Published / In production**, *any* Google account
> could sign in and obtain a token with our `aud` — at which point an
> `ALLOWED_EMAILS` allowlist becomes the only thing restricting access.

### Properties

- Real per-user identity; access limited to the OAuth client's authorized users.
- No shared secret in the client bundle.
- ID tokens are short-lived (~1h). The app is offline-first, so a stale token
  only matters when syncing while online; the client silently refreshes (One
  Tap / FedCM) and retries on the next sync tick. Occasionally the user may need
  to re-authenticate.

### Google Cloud setup (one-off)

1. Create an OAuth 2.0 **Web application** client ID in Google Cloud Console.
2. Add authorized JavaScript origins: the GitHub Pages origin and
   `http://localhost:5173`.
3. Configure the OAuth consent screen (External, Testing) and add household
   accounts as test users — no verification review needed at this scale.
4. Put the client ID in `PUBLIC_GOOGLE_CLIENT_ID` and Terraform `google_client_id`.
   Optionally pin specific emails in Terraform `allowed_emails`; otherwise access
   is limited to the consent screen's test users.

## Infrastructure & CI security

- **No long-lived AWS keys.** GitHub Actions assumes an IAM role via OIDC; the
  role's trust policy is scoped to this repository.
- **Least privilege.** The Lambda execution role can only touch its own DynamoDB
  table and log group. The CI role is scoped to the project's resource-name
  prefix.
- **State.** Terraform state lives in a private, versioned, encrypted S3 bucket
  with native lock files.
- **Cost/abuse containment.** Reserved concurrency = 1 caps runaway execution,
  and a CloudWatch alarm flags sustained invocation volume.

## Choosing a mode

Use the shared key for the simplest setup. Switch to Google sign-in when you
want real identity, an allowlist, and no secret in the client — the two modes
share the same request pipeline, so switching is a configuration change.
