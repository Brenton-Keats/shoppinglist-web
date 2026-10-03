/**
 * Pluggable authentication.
 *
 * Phase 1 implements the shared-API-key scheme that the current frontend and
 * Apps Script backend use, so the migration is behaviour-preserving. The
 * Authenticator interface is intentionally generic so Phase 5 can drop in a
 * Google ID-token verifier without touching the handlers.
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
      // No key configured — allow all (matches Apps Script behaviour).
      return { ok: true };
    }
    if (ctx.apiKeyFromQuery === expectedKey || ctx.apiKeyFromBody === expectedKey) {
      return { ok: true };
    }
    return { ok: false, error: 'Forbidden' };
  };
}
