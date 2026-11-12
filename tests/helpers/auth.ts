import { createHash } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';

export interface IssueBearerTokenOptions {
  clientId?: string;
  redirectUri?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export async function issueBearerToken(
  app: Express,
  options: IssueBearerTokenOptions = {},
): Promise<string> {
  const clientId = options.clientId ?? 'test-client';
  const redirectUri = options.redirectUri ?? 'http://localhost:54321/callback';
  const apiKey = options.apiKey ?? 'valid-user-api-key';

  const codeVerifier = 'test-pkce-verifier-with-sufficient-entropy-0123456789-abcdef';
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const authBody: Record<string, string> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  };

  if (options.username && options.password) {
    authBody.auth_mode = 'account';
    authBody.username = options.username;
    authBody.password = options.password;
  } else {
    authBody.auth_mode = 'api';
    authBody.api_key = apiKey;
  }

  const authRes = await request(app)
    .post('/authorize')
    .set('Host', 'mcp.example.com')
    .type('form')
    .send(authBody);

  if (!authRes.headers.location) {
    throw new Error(`Expected redirect from /authorize, got status ${authRes.status}: ${authRes.text}`);
  }

  const code = new URL(authRes.headers.location).searchParams.get('code')!;
  const tokenRes = await request(app)
    .post('/token')
    .set('Host', 'mcp.example.com')
    .type('form')
    .send({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });

  return tokenRes.body.access_token as string;
}
