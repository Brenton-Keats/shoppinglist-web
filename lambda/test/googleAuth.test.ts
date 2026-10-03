import { generateKeyPairSync, createSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGoogleAuthenticator, verifyGoogleToken, type KeyResolver } from '../src/googleAuth';

const CLIENT_ID = '123.apps.googleusercontent.com';
const KID = 'test-key-1';

// One RSA keypair for the whole suite.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk: JsonWebKey & { kid: string; alg: string } = {
  ...publicKey.export({ format: 'jwk' }),
  kid: KID,
  alg: 'RS256',
};

const resolver: KeyResolver = async (kid) => (kid === KID ? jwk : null);

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJwt(payload: Record<string, unknown>, opts: { kid?: string; alg?: string } = {}): string {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

const validPayload = () => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  email: 'user@example.com',
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 3600,
});

describe('verifyGoogleToken', () => {
  const base = { clientId: CLIENT_ID, allowedEmails: ['user@example.com'], getKey: resolver };

  it('accepts a valid, allowlisted token', async () => {
    const res = await verifyGoogleToken(signJwt(validPayload()), base);
    expect(res.ok).toBe(true);
    expect(res.email).toBe('user@example.com');
  });

  it('rejects a wrong audience', async () => {
    const res = await verifyGoogleToken(signJwt({ ...validPayload(), aud: 'other' }), base);
    expect(res).toMatchObject({ ok: false, error: 'bad_audience' });
  });

  it('rejects a bad issuer', async () => {
    const res = await verifyGoogleToken(signJwt({ ...validPayload(), iss: 'evil.com' }), base);
    expect(res).toMatchObject({ ok: false, error: 'bad_issuer' });
  });

  it('rejects an expired token', async () => {
    const res = await verifyGoogleToken(signJwt({ ...validPayload(), exp: Math.floor(Date.now() / 1000) - 10 }), base);
    expect(res).toMatchObject({ ok: false, error: 'expired' });
  });

  it('rejects an email not on the allowlist', async () => {
    const res = await verifyGoogleToken(signJwt({ ...validPayload(), email: 'intruder@example.com' }), base);
    expect(res).toMatchObject({ ok: false, error: 'email_not_allowed' });
  });

  it('rejects an unverified email', async () => {
    const res = await verifyGoogleToken(signJwt({ ...validPayload(), email_verified: false }), base);
    expect(res).toMatchObject({ ok: false, error: 'email_unverified' });
  });

  it('rejects a tampered signature', async () => {
    const token = signJwt(validPayload());
    const tampered = token.slice(0, -3) + (token.endsWith('AAA') ? 'BBB' : 'AAA');
    const res = await verifyGoogleToken(tampered, base);
    expect(res.ok).toBe(false);
  });

  it('accepts any authenticated account when no allowlist is configured', async () => {
    const res = await verifyGoogleToken(signJwt(validPayload()), { ...base, allowedEmails: [] });
    expect(res.ok).toBe(true);
    expect(res.email).toBe('user@example.com');
  });

  it('accepts a non-listed account when no allowlist is configured', async () => {
    const res = await verifyGoogleToken(
      signJwt({ ...validPayload(), email: 'someone-else@example.com' }),
      { ...base, allowedEmails: [] },
    );
    expect(res.ok).toBe(true);
  });

  it('still rejects a wrong audience even with no allowlist', async () => {
    const res = await verifyGoogleToken(signJwt({ ...validPayload(), aud: 'other' }), {
      ...base,
      allowedEmails: [],
    });
    expect(res).toMatchObject({ ok: false, error: 'bad_audience' });
  });
});

describe('createGoogleAuthenticator', () => {
  const auth = createGoogleAuthenticator({ clientId: CLIENT_ID, allowedEmails: ['user@example.com'], getKey: resolver });

  it('accepts a Bearer token', async () => {
    const res = await auth({ authorization: `Bearer ${signJwt(validPayload())}` });
    expect(res.ok).toBe(true);
  });

  it('rejects a missing header', async () => {
    expect(await auth({})).toMatchObject({ ok: false, error: 'Forbidden' });
  });

  it('rejects a non-bearer header', async () => {
    expect(await auth({ authorization: 'Basic abc' })).toMatchObject({ ok: false, error: 'Forbidden' });
  });
});
