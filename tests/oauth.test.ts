import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type { LubeLoggerGateway } from '../src/gateway/types.js';

describe('Embedded OAuth 2.1 Server', () => {
  let tmpDataDir: string;
  let config: AppConfig;
  let mockGateway: LubeLoggerGateway;
  let app: Express;

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lubelogger-oauth-test-'));

    config = {
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: 3000,
      DATA_DIR: tmpDataDir,
      OAUTH_ADMIN_PASSWORD: 'admin-password',
      OAUTH_ALLOWED_REDIRECT_URIS: [
        'http://localhost',
        'http://127.0.0.1',
        'https://mcp.example.com/callback',
      ],
      LUBELOGGER_URL: 'http://localhost:8383',
      LUBELOGGER_API_KEY: 'test-key',
      CACHE_TTL_SECONDS: 30,
    };

    mockGateway = {
      initialize: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
      getReadiness: vi.fn(() => ({
        ready: true,
        lastCheckedAt: new Date().toISOString(),
        serverUrl: 'http://localhost:8383',
      })),
      getServerInfo: vi.fn(async () => ({})),
      getServerVersion: vi.fn(async () => ({ version: '1.4.6' })),
      getHealth: vi.fn(async () => ({ status: 'healthy', healthy: true })),
      listVehicles: vi.fn(async () => []),
      getVehicleInfo: vi.fn(async () => ({} as any)),
      getAdjustedOdometer: vi.fn(async () => ({ adjustedOdometer: 1000 })),
      getRecords: vi.fn(async () => []),
      getMaintenanceSummary: vi.fn(async () => ({} as any)),
      listReminders: vi.fn(async () => []),
      getExtraFields: vi.fn(async () => []),
      manageVehicles: vi.fn(async () => ({} as any)),
      manageRecords: vi.fn(async () => ({} as any)),
      manageReminders: vi.fn(async () => ({} as any)),
      managePlans: vi.fn(async () => ({} as any)),
      manageSupplies: vi.fn(async () => ({} as any)),
      triggerReminders: vi.fn(async () => ({ success: true, message: 'ok' })),
      recalculateOdometer: vi.fn(async () => ({ success: true, message: 'ok' })),
      createBackup: vi.fn(async () => ({ success: true, message: 'ok' })),
    };

    app = createApp({ config, gateway: mockGateway });
  });

  afterEach(() => {
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it('exposes well-known OAuth discovery endpoints', async () => {
    const authServerRes = await request(app)
      .get('/.well-known/oauth-authorization-server')
      .set('Host', 'mcp.example.com');
    expect(authServerRes.status).toBe(200);
    expect(authServerRes.body.issuer).toBe('https://mcp.example.com');
    expect(authServerRes.body.authorization_endpoint).toBe('https://mcp.example.com/authorize');
    expect(authServerRes.body.token_endpoint).toBe('https://mcp.example.com/token');

    const protectedRes = await request(app)
      .get('/.well-known/oauth-protected-resource/mcp')
      .set('Host', 'mcp.example.com');
    expect(protectedRes.status).toBe(200);
    expect(protectedRes.body.resource).toBe('https://mcp.example.com/mcp');
  });

  it('registers dynamic clients per RFC 7591', async () => {
    const res = await request(app)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .send({
        client_name: 'Claude Desktop',
        redirect_uris: ['http://localhost:54321/callback'],
        token_endpoint_auth_method: 'none',
      });

    expect(res.status).toBe(201);
    expect(res.body.client_id).toBeDefined();
    expect(res.body.redirect_uris).toEqual(['http://localhost:54321/callback']);
  });

  it('completes full OAuth 2.1 PKCE authorization code flow and token refresh', async () => {
    const clientId = 'my-test-client';
    const redirectUri = 'http://localhost:54321/callback';
    const codeVerifier = 'valid-pkce-verifier-string-with-at-least-43-characters-12345';
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    // 1. Consent HTML screen
    const consentRes = await request(app)
      .get('/authorize')
      .set('Host', 'mcp.example.com')
      .query({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: 'xyz123',
      });
    expect(consentRes.status).toBe(200);
    expect(consentRes.text).toContain('Authorize LubeLogger MCP');

    // 2. Reject incorrect password
    const wrongPassRes = await request(app)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        password: 'wrong-password',
      });
    expect(wrongPassRes.status).toBe(401);
    expect(wrongPassRes.text).toContain('Invalid admin passphrase');

    // 3. Approve with correct password
    const approveRes = await request(app)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: 'xyz123',
        password: 'admin-password',
      });
    expect(approveRes.status).toBe(302);
    const location = new URL(approveRes.headers.location);
    expect(location.searchParams.get('state')).toBe('xyz123');
    const authCode = location.searchParams.get('code');
    expect(authCode).toBeTruthy();

    // 4. Exchange code for tokens
    const tokenRes = await request(app)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: authCode!,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.access_token).toBeDefined();
    expect(tokenRes.body.token_type).toBe('bearer');
    expect(tokenRes.body.refresh_token).toBeDefined();

    const initialAccessToken = tokenRes.body.access_token;
    const refreshToken = tokenRes.body.refresh_token;

    // 5. Use refresh token to obtain a new access token
    const refreshRes = await request(app)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
      });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.access_token).toBeDefined();
    expect(refreshRes.body.access_token).not.toBe(initialAccessToken);

    // 6. Revoke token
    const revokeRes = await request(app)
      .post('/revoke')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        client_id: clientId,
        token: refreshRes.body.access_token,
      });
    expect(revokeRes.status).toBe(200);
  });
});
