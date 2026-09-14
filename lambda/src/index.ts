import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyStructuredResultV2,
  LambdaFunctionURLEvent,
} from 'aws-lambda';
import { createApiKeyAuthenticator, type Authenticator } from './auth';
import { createGoogleAuthenticator } from './googleAuth';
import { DynamoStore } from './dynamoStore';
import { handleGetData, handlePostSync } from './handlers';
import type { Store } from './store';
import type { SyncRequest } from './types';

// ─── Reused across warm invocations ──────────────────────────────────────────

const TABLE_NAME = process.env.TABLE_NAME ?? '';
const API_KEY = process.env.API_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Selects the auth scheme: Google ID-token verification when GOOGLE_CLIENT_ID
 * is configured (fails closed on an empty allowlist), otherwise the shared API
 * key (open when unset). Built once and reused across warm invocations.
 */
function buildAuthenticator(): Authenticator {
  if (GOOGLE_CLIENT_ID) {
    return createGoogleAuthenticator({ clientId: GOOGLE_CLIENT_ID, allowedEmails: ALLOWED_EMAILS });
  }
  return createApiKeyAuthenticator(API_KEY);
}

const authenticate = buildAuthenticator();

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export interface NormalizedRequest {
  method: string;
  apiKeyFromQuery?: string;
  authorization?: string;
  /** Parsed JSON body, or undefined. */
  body?: SyncRequest & { apiKey?: string };
  /** True if the body string was present but not valid JSON. */
  bodyParseError?: boolean;
}

/**
 * Core request handling, independent of the AWS event shape so it can be tested
 * directly. CORS is handled by the Lambda Function URL, not here.
 */
export async function handleRequest(
  store: Store,
  authenticate: Authenticator,
  req: NormalizedRequest,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = req.method.toUpperCase();

  // Preflight normally never reaches the Lambda (handled by Function URL CORS),
  // but respond safely if it does.
  if (method === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  const auth = await authenticate({
    apiKeyFromQuery: req.apiKeyFromQuery,
    apiKeyFromBody: req.body?.apiKey,
    authorization: req.authorization,
  });
  if (!auth.ok) {
    return json(403, { success: false, error: auth.error ?? 'Forbidden' });
  }

  try {
    if (method === 'GET') {
      return json(200, await handleGetData(store));
    }

    if (method === 'POST') {
      if (req.bodyParseError) {
        return json(400, { success: false, error: 'Invalid JSON body' });
      }
      return json(200, await handlePostSync(store, req.body ?? {}));
    }

    return json(405, { success: false, error: 'Method not allowed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return json(500, { success: false, error: message });
  }
}

function normalizeEvent(event: LambdaFunctionURLEvent): NormalizedRequest {
  const method = event.requestContext?.http?.method ?? 'GET';
  const query = event.queryStringParameters ?? {};
  const headers = event.headers ?? {};

  let body: (SyncRequest & { apiKey?: string }) | undefined;
  let bodyParseError = false;
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    try {
      body = JSON.parse(raw);
    } catch {
      bodyParseError = true;
    }
  }

  return {
    method,
    apiKeyFromQuery: query.key,
    authorization: headers.authorization ?? headers.Authorization,
    body,
    bodyParseError,
  };
}

// Lambda entrypoint.
export async function handler(
  event: LambdaFunctionURLEvent,
): Promise<APIGatewayProxyStructuredResultV2> {
  const store = new DynamoStore(ddbDocClient, TABLE_NAME);
  return handleRequest(store, authenticate, normalizeEvent(event));
}
