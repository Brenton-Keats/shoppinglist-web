/**
 * Pluggable authentication.
 *
 * This module provides the shared-API-key scheme as a fallback. The generic
 * Authenticator interface lets the handlers stay auth-agnostic; the deployment
 * selects the Google ID-token verifier (src/googleAuth.ts) when GOOGLE_CLIENT_ID
 * is configured and falls back to the shared key otherwise (see src/index.ts).
 */

export interface AuthContext {
  /** Value of the ?key= query parameter, if present. */
  apiKeyFromQuery?: string;
  /** Value of an apiKey field in the POST body, if present. */
  apiKeyFromBody?: string;
  /** Raw Authorization header (used by future token-based auth). */
  authorization?: string;
}

export interface AuthResult {
  ok: boolean;
  /** Machine-readable reason on failure. */
  error?: string;
}

export type Authenticator = (ctx: AuthContext) => AuthResult | Promise<AuthResult>;

/**
 * Shared-API-key authenticator.
 *
 * If no key is configured, all requests are allowed (open access for initial
 * setup). Otherwise the key must match either the query parameter or the body
 * field.
 */
export function createApiKeyAuthenticator(expectedKey: string | undefined): Authenticator {
  return (ctx: AuthContext): AuthResult => {
    if (!expectedKey) {
      // No key configured — allow all (open mode for local/unauthenticated use).
      return { ok: true };
    }
    if (ctx.apiKeyFromQuery === expectedKey || ctx.apiKeyFromBody === expectedKey) {
      return { ok: true };
    }
    return { ok: false, error: 'Forbidden' };
  };
}
