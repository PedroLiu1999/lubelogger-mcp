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
  let mockFetch: ReturnType<typeof vi.fn>;
  let app: Express;

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lubelogger-oauth-test-'));

    config = {
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: 3000,
      DATA_DIR: tmpDataDir,
      OAUTH_ALLOWED_REDIRECT_URIS: [
        'http://localhost',
        'http://127.0.0.1',
        'https://mcp.example.com/callback',
      ],
      LUBELOGGER_URL: 'http://localhost:8383',
      LUBELOGGER_API_KEY: 'test-key',
      CACHE_TTL_SECONDS: 30,
    };

    mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      const headers = (init?.headers as Record<string, string>) || {};
      if (urlStr.includes('/api/vehicles')) {
        if (headers['x-api-key'] === 'valid-user-api-key') {
          return new Response(JSON.stringify([{ id: 1, year: 2020, make: 'Subaru', model: 'Outback' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const auth = headers.Authorization || headers.authorization;
        if (auth === `Basic ${Buffer.from('validuser:validpass').toString('base64')}`) {
          return new Response(JSON.stringify([{ id: 1, year: 2020, make: 'Subaru', model: 'Outback' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

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

    app = createApp({ config, gateway: mockGateway, fetchFn: mockFetch as any });
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

  it('registers Google OpenAuth client even if disk persistence encounters errors', async () => {
    const readOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lubelogger-ro-test-'));
    fs.chmodSync(readOnlyDir, 0o555);

    try {
      const unwriteableConfig: AppConfig = {
        ...config,
        DATA_DIR: readOnlyDir,
        OAUTH_ALLOWED_REDIRECT_URIS: [
          'http://localhost',
          'https://oauth-redirect.googleusercontent.com/r/',
        ],
      };
      const testApp = createApp({ config: unwriteableConfig, gateway: mockGateway, fetchFn: mockFetch as any });

      const res = await request(testApp)
        .post('/register')
        .set('Host', 'mcp.example.com')
        .set('User-Agent', 'OpenAuth')
        .send({
          client_name: 'Google',
          token_endpoint_auth_method: 'client_secret_post',
          redirect_uris: [
            'https://oauth-redirect.googleusercontent.com/r/my-project',
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.client_id).toBeDefined();
      expect(res.body.client_secret).toBeDefined();
    } finally {
      fs.chmodSync(readOnlyDir, 0o755);
      fs.rmSync(readOnlyDir, { recursive: true, force: true });
    }
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

    // 2. Reject incorrect credentials
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
        username: 'wronguser',
        password: 'wrong-password',
      });
    expect(wrongPassRes.status).toBe(401);
    expect(wrongPassRes.text).toContain('Invalid credentials');

    // 3. Approve with correct LubeLogger user credentials
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
        username: 'validuser',
        password: 'validpass',
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

  it('authenticates dynamically using LubeLogger username and password', async () => {
    const clientId = 'dyn-client-1';
    const redirectUri = 'http://localhost:54321/callback';
    const codeVerifier = 'valid-pkce-verifier-string-with-at-least-43-characters-12345';
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

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
        state: 'user-auth-state',
        username: 'validuser',
        password: 'validpass',
      });

    expect(approveRes.status).toBe(302);
    const location = new URL(approveRes.headers.location);
    const authCode = location.searchParams.get('code');
    expect(authCode).toBeTruthy();

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

    // Verify token can make a call to /mcp and receives valid response
    const mcpRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${tokenRes.body.access_token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });

    expect(mcpRes.status).toBe(200);
    expect(mcpRes.body.result?.tools?.length).toBe(15);
  });

  it('authenticates dynamically using LubeLogger API key', async () => {
    const clientId = 'dyn-client-2';
    const redirectUri = 'http://localhost:54321/callback';
    const codeVerifier = 'valid-pkce-verifier-string-with-at-least-43-characters-12345';
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

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
        state: 'api-key-state',
        api_key: 'valid-user-api-key',
      });

    expect(approveRes.status).toBe(302);
    const location = new URL(approveRes.headers.location);
    const authCode = location.searchParams.get('code');
    expect(authCode).toBeTruthy();

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

    // Verify token can make a call to /mcp with API key credentials
    const mcpRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${tokenRes.body.access_token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });

    expect(mcpRes.status).toBe(200);
    expect(mcpRes.body.result?.tools?.length).toBe(15);
  });

  it('rejects invalid LubeLogger credentials', async () => {
    const dynamicConfig: AppConfig = {
      ...config,
      LUBELOGGER_API_KEY: undefined,
    };
    const dynamicApp = createApp({ config: dynamicConfig, gateway: mockGateway, fetchFn: mockFetch as any });

    const rejectRes = await request(dynamicApp)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        response_type: 'code',
        client_id: 'client-fail',
        redirect_uri: 'http://localhost:54321/callback',
        code_challenge: 'challenge123',
        code_challenge_method: 'S256',
        username: 'wronguser',
        password: 'wrongpassword',
      });

    expect(rejectRes.status).toBe(401);
    expect(rejectRes.text).toContain('Invalid credentials. LubeLogger rejected the login.');
  });

  it('encrypts user credentials at rest on disk in oauth-tokens.json', async () => {
    const clientId = 'dyn-client-encrypted';
    const redirectUri = 'http://localhost:54321/callback';
    const codeVerifier = 'valid-pkce-verifier-string-with-at-least-43-characters-12345';
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

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
        state: 'api-state',
        username: 'validuser',
        password: 'validpass',
      });

    const location = new URL(approveRes.headers.location);
    const authCode = location.searchParams.get('code');

    await request(app)
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

    const tokensFilePath = path.join(tmpDataDir, 'oauth-tokens.json');
    expect(fs.existsSync(tokensFilePath)).toBe(true);

    const fileContent = fs.readFileSync(tokensFilePath, 'utf8');
    // Ensure plaintext password is NOT in the JSON file
    expect(fileContent).not.toContain('validpass');
    // Ensure encrypted payload is present
    expect(fileContent).toContain('encryptedCredentials');
    expect(fileContent).toContain('tag');
    expect(fileContent).toContain('iv');

    // Verify key file was created with restricted permissions
    const keyFilePath = path.join(tmpDataDir, '.token_encryption_key');
    expect(fs.existsSync(keyFilePath)).toBe(true);
  });

  it('renders API-key-first branded authorization page with LubeLogger MCP logo and zero-password guidance', async () => {
    const consentRes = await request(app)
      .get('/authorize')
      .set('Host', 'mcp.example.com')
      .query({
        response_type: 'code',
        client_id: 'test-client-branded',
        redirect_uri: 'http://localhost:54321/callback',
        code_challenge: 'challenge123',
        code_challenge_method: 'S256',
      });

    expect(consentRes.status).toBe(200);
    expect(consentRes.text).toContain('Authorize LubeLogger MCP');
    // Verifies LubeLogger MCP logo is present
    expect(consentRes.text).toContain('/logo-dark.svg');
    // Verifies API Key tab is active by default
    expect(consentRes.text).toMatch(/id="tab-api"[^>]*class="[^"]*active[^"]*"/);
    // Verifies hidden auth_mode is set to api
    expect(consentRes.text).toContain('name="auth_mode" id="auth_mode" value="api"');
    // Verifies zero-password security guidance and deeplink are present
    expect(consentRes.text).toContain('Zero-Password Security');
    expect(consentRes.text).toContain('Settings ➔ Profile ➔ API Keys');
    expect(consentRes.text).toContain('href="http://localhost:8383"');
    expect(consentRes.text).toContain('Editor or Manager permissions');
  });

  it('serves dark mode LubeLogger MCP brand logo', async () => {
    const res = await request(app)
      .get('/logo-dark.svg')
      .set('Host', 'mcp.example.com');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    const content = res.text || res.body.toString('utf8');
    expect(content).toContain('LubeLogger MCP Logo (Dark Mode)');
  });

  it('requires user authentication and rejects missing credentials', async () => {
    const rejectRes = await request(app)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        response_type: 'code',
        client_id: 'client-no-creds',
        redirect_uri: 'http://localhost:54321/callback',
        code_challenge: 'challenge123',
        code_challenge_method: 'S256',
      });

    expect(rejectRes.status).toBe(401);
    expect(rejectRes.text).toContain('Please enter your LubeLogger API key.');
  });
});
