import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { AuthContext, AuthResult, Authenticator } from './auth';

/**
 * Google ID-token verification with no external dependencies.
 *
 * Verifies an RS256 JWT issued by Google Identity Services against Google's
 * published JWKS, then checks the standard claims (iss/aud/exp) and an email
 * allowlist. Used by the Lambda when GOOGLE_CLIENT_ID is configured.
 */

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

interface Jwk {
  kty?: string;
  n?: string;
  e?: string;
  kid?: string;
  alg?: string;
  use?: string;
  [k: string]: unknown;
}

export interface GoogleClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean | string;
  [k: string]: unknown;
}

function base64UrlDecode(input: string): Buffer {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64');
}

/** Splits and decodes a JWT without verifying. Returns null if malformed. */
export function decodeJwt(
  token: string,
): { header: Record<string, unknown>; payload: GoogleClaims; signingInput: string; signature: Buffer } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]).toString('utf-8'));
    const payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf-8'));
    const signature = base64UrlDecode(parts[2]);
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature };
  } catch {
    return null;
  }
}

/** Resolves a JWK for a given key id. Implementations may cache. */
export type KeyResolver = (kid: string) => Promise<Jwk | null>;

interface CachedKeys {
  keys: Jwk[];
  expiresAt: number;
}

/**
 * Builds a KeyResolver backed by Google's JWKS endpoint, honouring the
 * Cache-Control max-age so keys are refetched only when needed.
 */
export function createGoogleKeyResolver(fetchImpl: typeof fetch = fetch): KeyResolver {
  let cache: CachedKeys | null = null;

  async function load(): Promise<Jwk[]> {
    if (cache && cache.expiresAt > Date.now()) {
      return cache.keys;
    }
    const res = await fetchImpl(GOOGLE_CERTS_URL);
    if (!res.ok) {
      throw new Error(`JWKS fetch failed: ${res.status}`);
    }
    const body = (await res.json()) as { keys: Jwk[] };
    const cacheControl = res.headers.get('cache-control') ?? '';
    const maxAge = /max-age=(\d+)/.exec(cacheControl)?.[1];
    const ttlMs = maxAge ? Number(maxAge) * 1000 : 3600_000;
    cache = { keys: body.keys ?? [], expiresAt: Date.now() + ttlMs };
    return cache.keys;
  }

  return async (kid: string) => {
    let keys = await load();
    let key = keys.find((k) => k.kid === kid);
    if (!key) {
      // Force a refresh once in case of key rotation.
      cache = null;
      keys = await load();
      key = keys.find((k) => k.kid === kid);
    }
    return key ?? null;
  };
}

export interface VerifyOptions {
  clientId: string;
  allowedEmails: string[];
  getKey: KeyResolver;
  /** Override for tests; defaults to Date.now. */
  now?: () => number;
}

export interface VerifyResult {
  ok: boolean;
  email?: string;
  error?: string;
}

export async function verifyGoogleToken(token: string, opts: VerifyOptions): Promise<VerifyResult> {
  const decoded = decodeJwt(token);
  if (!decoded) return { ok: false, error: 'malformed_token' };

  const { header, payload, signingInput, signature } = decoded;
  if (header.alg !== 'RS256') return { ok: false, error: 'unsupported_alg' };
  const kid = header.kid as string | undefined;
  if (!kid) return { ok: false, error: 'missing_kid' };

  const jwk = await opts.getKey(kid);
  if (!jwk) return { ok: false, error: 'unknown_key' };

  let signatureValid = false;
  try {
    const publicKey = createPublicKey(
      { key: jwk, format: 'jwk' } as unknown as Parameters<typeof createPublicKey>[0],
    );
    signatureValid = cryptoVerify('RSA-SHA256', Buffer.from(signingInput), publicKey, signature);
  } catch {
    return { ok: false, error: 'signature_error' };
  }
  if (!signatureValid) return { ok: false, error: 'bad_signature' };

  if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) return { ok: false, error: 'bad_issuer' };
  if (payload.aud !== opts.clientId) return { ok: false, error: 'bad_audience' };

  const now = (opts.now ?? Date.now)();
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) {
    return { ok: false, error: 'expired' };
  }

  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  if (!email || !verified) return { ok: false, error: 'email_unverified' };

  if (opts.allowedEmails.length === 0 || !opts.allowedEmails.includes(email)) {
    return { ok: false, error: 'email_not_allowed' };
  }

  return { ok: true, email };
}

/**
 * Authenticator that validates a Google ID token from the Authorization header.
 * Fails closed: an empty allowlist rejects everyone.
 */
export function createGoogleAuthenticator(config: {
  clientId: string;
  allowedEmails: string[];
  getKey?: KeyResolver;
}): Authenticator {
  const getKey = config.getKey ?? createGoogleKeyResolver();

  return async (ctx: AuthContext): Promise<AuthResult> => {
    const header = ctx.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      return { ok: false, error: 'Forbidden' };
    }
    const token = header.slice(header.indexOf(' ') + 1).trim();
    const result = await verifyGoogleToken(token, {
      clientId: config.clientId,
      allowedEmails: config.allowedEmails,
      getKey,
    });
    return result.ok ? { ok: true } : { ok: false, error: 'Forbidden' };
  };
}
