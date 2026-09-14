import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/index';
import { createApiKeyAuthenticator } from '../src/auth';
import { InMemoryStore } from './inMemoryStore';

const openAuth = createApiKeyAuthenticator(undefined);
const keyedAuth = createApiKeyAuthenticator('secret-key');

describe('handleRequest routing & auth', () => {
  it('GET returns 200 dataset when no key configured', async () => {
    const res = await handleRequest(new InMemoryStore(), openAuth, { method: 'GET' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.serverRevision).toBe(0);
    expect(res.headers?.['content-type']).toBe('application/json');
  });

  it('rejects with 403 when key is required but wrong', async () => {
    const res = await handleRequest(new InMemoryStore(), keyedAuth, { method: 'GET', apiKeyFromQuery: 'nope' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body as string).error).toBe('Forbidden');
  });

  it('accepts a correct query key', async () => {
    const res = await handleRequest(new InMemoryStore(), keyedAuth, { method: 'GET', apiKeyFromQuery: 'secret-key' });
    expect(res.statusCode).toBe(200);
  });

  it('accepts a correct body apiKey on POST', async () => {
    const res = await handleRequest(new InMemoryStore(), keyedAuth, {
      method: 'POST',
      body: { apiKey: 'secret-key', deviceId: 'd', baseRevision: 0, changes: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string).success).toBe(true);
  });

  it('returns 400 on invalid JSON body', async () => {
    const res = await handleRequest(new InMemoryStore(), openAuth, { method: 'POST', bodyParseError: true });
    expect(res.statusCode).toBe(400);
  });

  it('returns 405 for unsupported methods', async () => {
    const res = await handleRequest(new InMemoryStore(), openAuth, { method: 'PUT' });
    expect(res.statusCode).toBe(405);
  });

  it('answers OPTIONS preflight with 204', async () => {
    const res = await handleRequest(new InMemoryStore(), openAuth, { method: 'OPTIONS' });
    expect(res.statusCode).toBe(204);
  });
});
