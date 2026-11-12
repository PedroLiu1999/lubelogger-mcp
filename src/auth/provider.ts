import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Response } from 'express';
import type { AppConfig } from '../config.js';
import { verifyLubeLoggerCredentials } from '../gateway/lubeLoggerGateway.js';
import type { UserCredentials } from '../gateway/types.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  FileTokenStore,
  REFRESH_TOKEN_TTL_SECONDS,
} from './tokenStore.js';

export const SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS = [
  'none',
  'client_secret_post',
  'client_secret_basic',
] as const;

export type SupportedTokenEndpointAuthMethod = (typeof SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS)[number];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

export function isAllowedRedirectUri(
  redirectUri: string,
  allowedRedirectUris: readonly string[] = [],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  if (parsed.pathname.includes('..') || parsed.username !== '' || parsed.password !== '') {
    return false;
  }

  const isLoopbackCandidate = LOOPBACK_HOSTS.has(parsed.hostname);

  // Non-loopback URIs MUST use https://
  if (!isLoopbackCandidate && parsed.protocol !== 'https:') {
    return false;
  }

  for (const allowed of allowedRedirectUris) {
    if (allowed === redirectUri) {
      return true;
    }
    try {
      const parsedAllowed = new URL(allowed);
      if (isLoopbackCandidate && LOOPBACK_HOSTS.has(parsedAllowed.hostname)) {
        if (parsedAllowed.protocol !== parsed.protocol) {
          continue;
        }
        // If an explicit path is configured on loopback, candidate pathname must match
        if (parsedAllowed.pathname !== '/' && parsedAllowed.pathname !== '') {
          if (parsed.pathname !== parsedAllowed.pathname) {
            continue;
          }
        }
        return true;
      }

      // Non-loopback prefix matching if allowed URI ends with '/' (e.g. https://oauth-redirect.googleusercontent.com/r/)
      if (
        !isLoopbackCandidate &&
        parsedAllowed.protocol === parsed.protocol &&
        parsedAllowed.hostname === parsed.hostname &&
        allowed.endsWith('/')
      ) {
        const allowedBasePath = parsedAllowed.pathname.endsWith('/')
          ? parsedAllowed.pathname
          : `${parsedAllowed.pathname}/`;
        if (parsed.pathname.startsWith(allowedBasePath)) {
          return true;
        }
      }
    } catch {
      // Ignore invalid configured allowed URI
    }
  }

  return false;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderConsentHtml(options: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes?: string[];
  resource?: string;
  errorMessage?: string;
  lubeLoggerUrl?: string;
}): string {
  const scopesText = options.scopes && options.scopes.length > 0 ? options.scopes.join(' ') : 'mcp:tools';
  const errorBanner = options.errorMessage
    ? `<div role="alert" style="color: #f87171; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.75rem 1rem; border-radius: 0.5rem; margin-bottom: 1.25rem; font-size: 0.875rem;">${escapeHtml(options.errorMessage)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <title>LubeLogger MCP · Sign In</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #0F172A;
      color: #F8FAFC;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .auth-card {
      background: #1E293B;
      max-width: 26rem;
      width: 100%;
      padding: 2.25rem;
      border-radius: 1rem;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      border: 1px solid #334155;
    }
    .tab-btn {
      flex: 1;
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
      font-weight: 600;
      border-radius: 0.375rem;
      border: 1px solid transparent;
      background: transparent;
      color: #94A3B8;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tab-btn.active {
      background: #0F172A;
      color: #F8FAFC;
      border-color: #475569;
    }
    .input-field {
      width: 100%;
      padding: 0.625rem 0.75rem;
      background: #0F172A;
      border: 1px solid #334155;
      border-radius: 0.5rem;
      color: #F8FAFC;
      font-size: 0.9375rem;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .input-field:focus {
      border-color: #0284C7;
      box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.25);
    }
    .submit-btn {
      width: 100%;
      background: #0284C7;
      color: #FFFFFF;
      border: none;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.9375rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(2, 132, 199, 0.3);
      transition: background 0.15s ease;
    }
    .submit-btn:hover {
      background: #0369A1;
    }
  </style>
</head>
<body>
  <div class="auth-card">
    <div style="text-align: center; margin-bottom: 1.5rem;">
      <img src="/logo-dark.svg" alt="LubeLogger MCP" style="width: 220px; max-width: 100%; height: auto; margin-bottom: 0.75rem;" />
      <h1 style="font-size: 1.35rem; font-weight: 700; margin: 0.5rem 0 0.25rem 0; color: #F8FAFC;">Authorize LubeLogger MCP</h1>
      <p style="font-size: 0.8125rem; color: #94A3B8; margin: 0;">Authorize AI assistant access to your vehicle records</p>
    </div>

    <div style="background: rgba(15, 23, 42, 0.6); padding: 0.625rem 0.875rem; border-radius: 0.5rem; border: 1px solid #334155; margin-bottom: 1.25rem; font-size: 0.8125rem; color: #94A3B8;">
      Client <strong style="color: #F8FAFC;">${escapeHtml(options.clientId)}</strong> is requesting access (scope: <code style="color: #38BDF8;">${escapeHtml(scopesText)}</code>).
    </div>

    ${errorBanner}

    <!-- Tab navigation -->
    <div style="display: flex; gap: 0.375rem; background: rgba(15, 23, 42, 0.4); padding: 0.25rem; border-radius: 0.5rem; margin-bottom: 1.25rem; border: 1px solid #334155;">
      <button type="button" id="tab-api" class="tab-btn active" onclick="switchTab('api')">API Key (Recommended)</button>
      <button type="button" id="tab-account" class="tab-btn" onclick="switchTab('account')">Account</button>
    </div>

    <form method="POST" action="/authorize">
      <input type="hidden" name="auth_mode" id="auth_mode" value="api" />
      <input type="hidden" name="response_type" value="code" />
      <input type="hidden" name="client_id" value="${escapeHtml(options.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(options.redirectUri)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(options.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="S256" />
      ${options.state !== undefined ? `<input type="hidden" name="state" value="${escapeHtml(options.state)}" />` : ''}
      ${options.scopes && options.scopes.length > 0 ? `<input type="hidden" name="scope" value="${escapeHtml(options.scopes.join(' '))}" />` : ''}
      ${options.resource !== undefined ? `<input type="hidden" name="resource" value="${escapeHtml(options.resource)}" />` : ''}

      <!-- API Key Panel (Default) -->
      <div id="panel-api">
        <div style="background: rgba(2, 132, 199, 0.08); border: 1px solid rgba(2, 132, 199, 0.3); border-radius: 0.5rem; padding: 0.75rem; margin-bottom: 1rem; font-size: 0.8125rem; color: #94A3B8; line-height: 1.4;">
          <div style="display: flex; align-items: center; gap: 0.375rem; color: #38BDF8; font-weight: 600; margin-bottom: 0.25rem;">
            <span>🛡️ Zero-Password Security</span>
          </div>
          <div>Your account password is never collected or stored. In LubeLogger, go to ${options.lubeLoggerUrl ? `<a href="${escapeHtml(options.lubeLoggerUrl)}" target="_blank" rel="noopener noreferrer" style="color: #38BDF8; text-decoration: underline;"><strong>Settings ➔ Profile ➔ API Keys</strong></a>` : `<strong>Settings ➔ Profile ➔ API Keys</strong>`} and click <strong>Generate</strong> with Editor or Manager permissions.</div>
        </div>

        <div style="margin-bottom: 1.25rem;">
          <label for="api_key" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.375rem; color: #CBD5E1;">LubeLogger API Key</label>
          <input id="api_key" type="password" name="api_key" class="input-field" placeholder="Enter API Key (x-api-key)" autocomplete="off" />
        </div>
      </div>

      <!-- Account Panel -->
      <div id="panel-account" style="display: none;">
        <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 0.5rem; padding: 0.625rem 0.75rem; margin-bottom: 1rem; font-size: 0.75rem; color: #FBBF24; line-height: 1.4;">
          ⚠️ <strong>Security Notice:</strong> Using your account password requires two-way encrypted storage. We strongly recommend using the <strong>API Key</strong> tab instead.
        </div>
        <div style="margin-bottom: 1rem;">
          <label for="username" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.375rem; color: #CBD5E1;">LubeLogger Username</label>
          <input id="username" type="text" name="username" class="input-field" placeholder="Username" autocomplete="username" />
        </div>
        <div style="margin-bottom: 1.25rem;">
          <label for="password" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.375rem; color: #CBD5E1;">Password</label>
          <input id="password" type="password" name="password" class="input-field" placeholder="Account password" autocomplete="current-password" />
        </div>
      </div>

      <button type="submit" class="submit-btn">Sign in &amp; Authorize</button>
    </form>
  </div>

  <script>
    function switchTab(mode) {
      const tabAccount = document.getElementById('tab-account');
      const tabApi = document.getElementById('tab-api');
      const panelAccount = document.getElementById('panel-account');
      const panelApi = document.getElementById('panel-api');
      if (mode === 'api') {
        tabApi.classList.add('active');
        tabAccount.classList.remove('active');
        panelApi.style.display = 'block';
        panelAccount.style.display = 'none';
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
      } else {
        tabAccount.classList.add('active');
        tabApi.classList.remove('active');
        panelAccount.style.display = 'block';
        panelApi.style.display = 'none';
        document.getElementById('api_key').value = '';
      }
      document.getElementById('auth_mode').value = mode;
    }
  </script>
</body>
</html>`;
}

interface AuthorizationCodeRecord {
  code: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: URL;
  expiresAt: number;
  userCredentials?: UserCredentials;
}

export class EmbeddedOAuthProvider implements OAuthServerProvider {
  private readonly config: AppConfig;
  private readonly store: OAuthRegisteredClientsStore;
  private readonly tokenStore: FileTokenStore;
  private readonly allowedRedirectUris: Set<string>;
  private readonly authorizationCodes = new Map<string, AuthorizationCodeRecord>();
  private readonly fetchFn: typeof fetch;

  constructor(config: AppConfig, fetchFn: typeof fetch = fetch) {
    this.config = config;
    this.tokenStore = new FileTokenStore(config.DATA_DIR);
    this.allowedRedirectUris = new Set<string>(config.OAUTH_ALLOWED_REDIRECT_URIS);
    this.fetchFn = fetchFn;

    this.store = {
      getClient: (clientId: string) => {
        if (!clientId || clientId.trim() === '') {
          return undefined;
        }
        const registered = this.tokenStore.getClient(clientId);
        if (registered) {
          return registered;
        }
        return {
          client_id: clientId,
          redirect_uris: Array.from(this.allowedRedirectUris),
        };
      },
      registerClient: async (
        client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> & {
          client_id?: string;
          client_id_issued_at?: number;
        },
      ) => {
        try {
          const supportedAuthMethods = new Set<string>(SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS);
          if (
            client.token_endpoint_auth_method !== undefined &&
            !supportedAuthMethods.has(client.token_endpoint_auth_method)
          ) {
            throw new InvalidClientMetadataError(
              `Unsupported token_endpoint_auth_method: ${client.token_endpoint_auth_method}. Supported: ${SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS.join(', ')}`,
            );
          }

          const isPublicClient = client.token_endpoint_auth_method === 'none';
          const clientSecret = isPublicClient
            ? undefined
            : (client.client_secret ?? randomBytes(32).toString('hex'));
          const clientSecretExpiresAt = isPublicClient ? undefined : client.client_secret_expires_at;
          const authMethod = isPublicClient
            ? 'none'
            : (client.token_endpoint_auth_method ?? 'client_secret_basic');

          const redirectUris = client.redirect_uris ?? [];
          if (redirectUris.length === 0) {
            throw new InvalidClientMetadataError(
              'Client registration must include at least one redirect_uri',
            );
          }

          for (const uri of redirectUris) {
            if (!isAllowedRedirectUri(uri, this.config.OAUTH_ALLOWED_REDIRECT_URIS)) {
              throw new InvalidClientMetadataError(
                `Redirect URI not allowed by server allowlist policy: ${uri}`,
              );
            }
          }

          const clientId = client.client_id ?? randomUUID();
          if (this.tokenStore.getClient(clientId)) {
            throw new InvalidClientMetadataError(
              'Cannot overwrite existing client registration',
            );
          }

          const registered: OAuthClientInformationFull = {
            ...client,
            client_id: clientId,
            client_id_issued_at:
              client.client_id_issued_at ?? Math.floor(Date.now() / 1000),
            client_secret: clientSecret,
            client_secret_expires_at: clientSecretExpiresAt,
            token_endpoint_auth_method: authMethod,
            redirect_uris: redirectUris,
          };

          this.tokenStore.saveClient(registered);
          return registered;
        } catch (error) {
          console.error('[register] ❌ registerClient exception:', error);
          throw error;
        }
      },
    };
  }

  recordCandidateRedirectUri(redirectUri: unknown): void {
    if (
      typeof redirectUri === 'string' &&
      isAllowedRedirectUri(redirectUri, this.config.OAUTH_ALLOWED_REDIRECT_URIS)
    ) {
      this.allowedRedirectUris.add(redirectUri);
    }
  }

  evictExpiredAuthorizationCodes(
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): number {
    let evictedCount = 0;
    for (const [code, record] of this.authorizationCodes.entries()) {
      if (record.expiresAt <= nowSeconds) {
        this.authorizationCodes.delete(code);
        evictedCount++;
      }
    }
    return evictedCount;
  }

  getUserCredentials(token: string): UserCredentials | undefined {
    return this.tokenStore.getUserCredentials(token);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.store;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const req = res.req;
    if (req && req.method === 'POST') {
      const authMode = typeof req.body?.auth_mode === 'string' ? req.body.auth_mode : undefined;

      const submittedApiKey =
        typeof req.body?.api_key === 'string' && req.body.api_key.trim() !== ''
          ? req.body.api_key.trim()
          : typeof req.body?.apiKey === 'string' && req.body.apiKey.trim() !== ''
            ? req.body.apiKey.trim()
            : undefined;

      const submittedUsername =
        typeof req.body?.username === 'string' && req.body.username.trim() !== ''
          ? req.body.username.trim()
          : undefined;

      const submittedPassword =
        typeof req.body?.password === 'string' && req.body.password !== ''
          ? req.body.password
          : undefined;

      let verifiedUserCredentials: UserCredentials | undefined;
      let authPassed = false;
      let failureReason = 'Invalid credentials. Please provide valid LubeLogger login details.';

      // Case 1: API Key tab or api_key submitted (default)
      if (authMode === 'api' || (!authMode && submittedApiKey) || (!authMode && !submittedUsername)) {
        if (!submittedApiKey) {
          failureReason = 'Please enter your LubeLogger API key.';
        } else {
          const verifyResult = await verifyLubeLoggerCredentials(
            this.config.LUBELOGGER_URL,
            { apiKey: submittedApiKey },
            this.fetchFn,
          );
          if (verifyResult.valid) {
            authPassed = true;
            verifiedUserCredentials = { apiKey: submittedApiKey };
          } else {
            failureReason = verifyResult.error || 'Invalid LubeLogger API key.';
          }
        }
      }
      // Case 2: Username & Password tab
      else {
        if (!submittedUsername || !submittedPassword) {
          failureReason = 'Please enter both your LubeLogger username and password.';
        } else {
          const verifyResult = await verifyLubeLoggerCredentials(
            this.config.LUBELOGGER_URL,
            { username: submittedUsername, password: submittedPassword },
            this.fetchFn,
          );
          if (verifyResult.valid) {
            authPassed = true;
            verifiedUserCredentials = { username: submittedUsername, password: submittedPassword };
          } else {
            failureReason = verifyResult.error || 'Invalid LubeLogger username or password.';
          }
        }
      }

      if (!authPassed) {
        const errorHtml = renderConsentHtml({
          clientId: client.client_id,
          redirectUri: params.redirectUri,
          codeChallenge: params.codeChallenge,
          state: params.state,
          scopes: params.scopes,
          resource: params.resource?.href,
          errorMessage: failureReason,
          lubeLoggerUrl: this.config.LUBELOGGER_URL,
        });
        res.status(401).type('html').send(errorHtml);
        return;
      }

      const code = randomBytes(32).toString('hex');
      const nowSeconds = Math.floor(Date.now() / 1000);
      this.evictExpiredAuthorizationCodes(nowSeconds);
      this.authorizationCodes.set(code, {
        code,
        clientId: client.client_id,
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        scopes: params.scopes && params.scopes.length > 0 ? params.scopes : ['mcp:tools'],
        resource: params.resource,
        expiresAt: nowSeconds + 600,
        userCredentials: verifiedUserCredentials,
      });

      const targetUrl = new URL(params.redirectUri);
      targetUrl.searchParams.set('code', code);
      if (params.state !== undefined) {
        targetUrl.searchParams.set('state', params.state);
      }
      res.redirect(302, targetUrl.href);
      return;
    }

    const html = renderConsentHtml({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes,
      resource: params.resource?.href,
      lubeLoggerUrl: this.config.LUBELOGGER_URL,
    });
    res.status(200).type('html').send(html);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.evictExpiredAuthorizationCodes(nowSeconds);
    const record = this.authorizationCodes.get(authorizationCode);
    if (!record || record.clientId !== client.client_id || record.expiresAt <= nowSeconds) {
      if (record && record.expiresAt <= nowSeconds) {
        this.authorizationCodes.delete(authorizationCode);
      }
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.evictExpiredAuthorizationCodes(nowSeconds);
    const record = this.authorizationCodes.get(authorizationCode);
    this.authorizationCodes.delete(authorizationCode);

    if (!record || record.clientId !== client.client_id || record.expiresAt <= nowSeconds) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }

    if (redirectUri !== undefined && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match authorization request');
    }

    const effectiveResource = (resource ?? record.resource)?.href ?? `${this.config.PUBLIC_URL}/mcp`;
    const accessToken = randomBytes(32).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');

    this.tokenStore.saveTokens(
      {
        token: accessToken,
        clientId: client.client_id,
        scopes: record.scopes,
        expiresAt: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
        resource: effectiveResource,
        userCredentials: record.userCredentials,
      },
      {
        token: refreshToken,
        clientId: client.client_id,
        scopes: record.scopes,
        expiresAt: nowSeconds + REFRESH_TOKEN_TTL_SECONDS,
        resource: effectiveResource,
        userCredentials: record.userCredentials,
      },
    );

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: record.scopes.join(' '),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const existingRefresh = this.tokenStore.getRefreshToken(refreshToken);
    if (!existingRefresh || existingRefresh.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired refresh token');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const effectiveScopes =
      scopes && scopes.length > 0 ? scopes : existingRefresh.scopes;
    const effectiveResource =
      resource?.href ?? existingRefresh.resource ?? `${this.config.PUBLIC_URL}/mcp`;
    const newAccessToken = randomBytes(32).toString('hex');
    const extendedRefreshExpiresAt = Math.max(
      existingRefresh.expiresAt + 1,
      nowSeconds + REFRESH_TOKEN_TTL_SECONDS,
    );

    this.tokenStore.saveTokens(
      {
        token: newAccessToken,
        clientId: client.client_id,
        scopes: effectiveScopes,
        expiresAt: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
        resource: effectiveResource,
        userCredentials: existingRefresh.userCredentials,
      },
      {
        token: existingRefresh.token,
        clientId: existingRefresh.clientId,
        scopes: effectiveScopes,
        expiresAt: extendedRefreshExpiresAt,
        resource: effectiveResource,
        userCredentials: existingRefresh.userCredentials,
      },
    );

    return {
      access_token: newAccessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: existingRefresh.token,
      scope: effectiveScopes.join(' '),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.tokenStore.getAccessToken(token);
    if (!record) {
      throw new InvalidTokenError('Invalid or expired access token');
    }
    return {
      token: record.token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      resource: record.resource ? new URL(record.resource) : undefined,
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.tokenStore.revokeToken(client.client_id, request.token);
  }
}
