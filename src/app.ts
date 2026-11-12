import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { metadataHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/metadata.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  EmbeddedOAuthProvider,
  SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS,
} from './auth/provider.js';
import {
  extractCandidateRedirectUris,
  normalizeRegistrationBody,
} from './auth/registration.js';
import type { AppConfig } from './config.js';
import {
  createGatewayRegistry,
  GatewayRegistry,
} from './gateway/gatewayRegistry.js';
import type { LubeLoggerGateway } from './gateway/types.js';
import { createMcpServer } from './mcp/server.js';

export interface CreateAppOptions {
  config: AppConfig;
  gateway?: LubeLoggerGateway;
  gatewayRegistry?: GatewayRegistry;
  fetchFn?: typeof fetch;
  mcpRateLimiter?: express.RequestHandler;
}

export function createTokenRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function createMcpRateLimiter(options?: { windowMs?: number; max?: number }) {
  return rateLimit({
    windowMs: options?.windowMs ?? 60 * 1000,
    max: options?.max ?? 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function sanitizeClientMetadata(record: unknown): {
  client_id?: string;
  client_name?: string;
  token_endpoint_auth_method?: string;
  redirect_uris_count?: number;
} {
  if (!record || typeof record !== 'object') {
    return {
      client_id: undefined,
      client_name: undefined,
      token_endpoint_auth_method: undefined,
      redirect_uris_count: undefined,
    };
  }
  const obj = record as Record<string, unknown>;
  const redirectUris = Array.isArray(obj.redirect_uris)
    ? obj.redirect_uris
    : typeof obj.redirect_uris === 'string'
      ? [obj.redirect_uris]
      : typeof obj.redirect_uri === 'string'
        ? [obj.redirect_uri]
        : undefined;

  return {
    client_id: typeof obj.client_id === 'string' ? obj.client_id : undefined,
    client_name: typeof obj.client_name === 'string' ? obj.client_name : undefined,
    token_endpoint_auth_method:
      typeof obj.token_endpoint_auth_method === 'string'
        ? obj.token_endpoint_auth_method
        : undefined,
    redirect_uris_count: redirectUris !== undefined ? redirectUris.length : undefined,
  };
}

export function createApp(options: CreateAppOptions): Express {
  const { config, fetchFn } = options;
  const gatewayRegistry =
    options.gatewayRegistry ??
    createGatewayRegistry({
      serverUrl: config.LUBELOGGER_URL,
      cacheTtlSeconds: config.CACHE_TTL_SECONDS,
      fetchFn,
      defaultGateway: options.gateway,
      defaultCredentials: {
        apiKey: config.LUBELOGGER_API_KEY,
        username: config.LUBELOGGER_USERNAME,
        password: config.LUBELOGGER_PASSWORD,
      },
    });

  const app = express();
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  const publicHostname = new URL(config.PUBLIC_URL).hostname;
  const allowedHosts = Array.from(
    new Set([publicHostname, 'localhost', '127.0.0.1', '[::1]']),
  );

  app.use(hostHeaderValidation(allowedHosts));
  app.use(express.json());

  const issuerUrl = new URL(config.PUBLIC_URL);
  const resourceServerUrl = new URL(`${config.PUBLIC_URL}/mcp`);
  const scopesSupported = ['mcp:tools'];
  const oauthProvider = new EmbeddedOAuthProvider(config, fetchFn);
  const logoUrl = config.LOGO_URL ?? `${config.PUBLIC_URL}/logo-symbol.png`;

  const oauthMetadata: OAuthMetadata = {
    ...createOAuthMetadata({
      provider: oauthProvider,
      issuerUrl,
      scopesSupported,
    }),
    issuer: config.PUBLIC_URL,
    logo_uri: logoUrl,
    token_endpoint_auth_methods_supported: Array.from(SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS),
    revocation_endpoint_auth_methods_supported: Array.from(SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS),
  };

  const protectedResourceMetadata: OAuthProtectedResourceMetadata = {
    resource: resourceServerUrl.href,
    authorization_servers: [config.PUBLIC_URL],
    scopes_supported: scopesSupported,
    bearer_methods_supported: ['header'],
    resource_name: 'LubeLogger MCP Server',
    logo_uri: logoUrl,
  };

  // Serve official repository brand assets (docs/logo.svg, docs/logo-dark.svg, docs/logo-symbol.svg)
  const docsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../docs',
  );

  const readBrandAsset = (filename: string, fallback: Buffer): Buffer => {
    try {
      const filePath = path.join(docsDir, filename);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
    } catch {
      // Ignore disk error; use fallback
    }
    return fallback;
  };

  const svgLogoDark = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 256" width="760" height="256" role="img" aria-labelledby="title-lockup-dark"><title id="title-lockup-dark">LubeLogger MCP Logo (Dark Mode)</title><g fill-rule="evenodd" transform="translate(10, 0)"><path fill="#E2E8F0" d="M 128 16 A 112 112 0 1 0 128.01 16 Z M 128 40 A 88 88 0 1 1 127.99 40 Z"/><path fill="#E2E8F0" d="M 40 120 H 92 V 136 H 40 Z"/><path fill="#E2E8F0" d="M 164 120 H 216 V 136 H 164 Z"/><path fill="#E2E8F0" d="M 120 178 H 136 V 216 H 120 Z"/><path fill="#F59E0B" fill-rule="evenodd" d="M 128 46 C 128 46 172 104 172 138 A 44 44 0 0 1 84 138 C 84 104 128 46 128 46 Z M 128 110 C 133 127 141 133 154 138 C 141 143 133 149 128 166 C 123 149 115 143 102 138 C 115 133 123 127 128 110 Z"/></g><text x="270" y="146" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', Helvetica, Arial, sans-serif" font-size="64" font-weight="700" fill="#F8FAFC" letter-spacing="-1.5">lubelogger</text><g transform="translate(615, 96)"><rect width="105" height="54" rx="14" fill="#334155"/><text x="52" y="37" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace" font-size="28" font-weight="800" fill="#F8FAFC" text-anchor="middle" letter-spacing="1.5">MCP</text><path fill="#FBBF24" d="M 96 -6 C 98 0 100 2 106 4 C 100 6 98 8 96 14 C 94 8 92 6 86 4 C 92 2 94 0 96 -6 Z"/></g></svg>`,
    'utf8',
  );

  const svgLogoSymbol = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title-neural-wheel"><title id="title-neural-wheel">LubeLogger MCP - Neural Wheel Mark</title><g id="symbol" fill-rule="evenodd"><path fill="#1E293B" d="M 128 16 A 112 112 0 1 0 128.01 16 Z M 128 40 A 88 88 0 1 1 127.99 40 Z"/><path fill="#1E293B" d="M 40 120 H 92 V 136 H 40 Z"/><path fill="#1E293B" d="M 164 120 H 216 V 136 H 164 Z"/><path fill="#1E293B" d="M 120 178 H 136 V 216 H 120 Z"/><path fill="#F59E0B" d="M 128 46 C 128 46 172 104 172 138 A 44 44 0 0 1 84 138 C 84 104 128 46 128 46 Z M 128 110 C 133 127 141 133 154 138 C 141 143 133 149 128 166 C 123 149 115 143 102 138 C 115 133 123 127 128 110 Z"/></g></svg>`,
    'utf8',
  );

  app.get('/logo-dark.svg', (_req, res) => {
    res.type('image/svg+xml; charset=utf-8').send(readBrandAsset('logo-dark.svg', svgLogoDark));
  });

  app.get('/logo-symbol.png', (_req, res) => {
    const pngBuffer = readBrandAsset('logo-symbol.png', svgLogoSymbol);
    const contentType =
      pngBuffer.length >= 8 &&
      pngBuffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        ? 'image/png'
        : 'image/svg+xml; charset=utf-8';
    res.type(contentType).send(pngBuffer);
  });

  app.use(
    '/.well-known/oauth-protected-resource/mcp',
    metadataHandler(protectedResourceMetadata),
  );
  app.use(
    '/.well-known/oauth-authorization-server',
    metadataHandler(oauthMetadata),
  );

  const authorizePostLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post('/authorize', authorizePostLimiter);

  const registerPostLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post('/register', registerPostLimiter);

  const tokenPostLimiter = createTokenRateLimiter();
  app.post('/token', tokenPostLimiter);

  const revokePostLimiter = createTokenRateLimiter();
  app.post('/revoke', revokePostLimiter);

  app.use('/authorize', express.urlencoded({ extended: false }), (req, _res, next) => {
    if (req.method === 'POST') {
      req.body = {
        response_type: 'code',
        code_challenge_method: 'S256',
        ...req.query,
        ...(typeof req.body === 'object' && req.body !== null ? req.body : {}),
      };
    }
    const candidate = req.method === 'POST' ? req.body?.redirect_uri : req.query?.redirect_uri;
    oauthProvider.recordCandidateRedirectUri(candidate);
    next();
  });

  const basicAuthToBody = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const authHeader = req.headers.authorization;
    if (authHeader && /^Basic\s+/i.test(authHeader)) {
      try {
        const credentials = Buffer.from(authHeader.replace(/^Basic\s+/i, '').trim(), 'base64').toString('utf8');
        const colonIdx = credentials.indexOf(':');
        if (colonIdx !== -1) {
          const clientId = decodeURIComponent(credentials.slice(0, colonIdx));
          const clientSecret = decodeURIComponent(credentials.slice(colonIdx + 1));
          if (req.body && typeof req.body === 'object') {
            if (req.body.client_secret || (req.body.client_id && req.body.client_id !== clientId)) {
              res.status(400).json({
                error: 'invalid_request',
                error_description: 'Multiple client authentication methods found in request',
              });
              return;
            }
            req.body.client_id = clientId;
            req.body.client_secret = clientSecret;
          }
        }
      } catch {
        // Ignore parse error; downstream clientAuth handles credentials
      }
    }
    next();
  };

  app.use('/token', express.urlencoded({ extended: false }), basicAuthToBody);
  app.use('/revoke', express.urlencoded({ extended: false }), basicAuthToBody);

  app.use(
    '/register',
    express.json(),
    express.urlencoded({ extended: false }),
    (req, res, next) => {
      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        if (res.statusCode >= 400) {
          console.error(
            `[register] ❌ ${res.statusCode} registration failed:`,
            JSON.stringify(body),
          );
        } else {
          console.log(
            `[register] ✅ ${res.statusCode} client registered:`,
            JSON.stringify(sanitizeClientMetadata(body)),
          );
        }
        return originalJson(body);
      };

      if (req.method === 'POST') {
        req.body = normalizeRegistrationBody(req.body);

        console.log(`[register] 📥 incoming registration request:`, {
          contentType: req.headers['content-type'],
          userAgent: req.headers['user-agent'],
          metadata: sanitizeClientMetadata(req.body),
        });

        for (const uri of extractCandidateRedirectUris(req.body)) {
          oauthProvider.recordCandidateRedirectUri(uri);
        }
      }
      next();
    },
  );

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl,
      resourceServerUrl,
      scopesSupported,
      resourceName: 'LubeLogger MCP Server',
      clientRegistrationOptions: {
        rateLimit: false,
      },
      tokenOptions: {
        rateLimit: false,
      },
      revocationOptions: {
        rateLimit: false,
      },
    }),
  );

  const bearerAuth = requireBearerAuth({
    verifier: oauthProvider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
  });

  app.get('/healthz', (_req, res) => {
    const readiness = gatewayRegistry.getReadiness();
    res.status(200).json({
      status: 'ok',
      ready: readiness.ready,
      lastCheckedAt: readiness.lastCheckedAt,
    });
  });

  const mcpRateLimiter = options.mcpRateLimiter ?? createMcpRateLimiter();

  app.post('/mcp', mcpRateLimiter, bearerAuth, async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.split(' ')[1] : undefined;
    const userCredentials = token ? oauthProvider.getUserCredentials(token) : undefined;

    const activeGateway = gatewayRegistry.getGateway(userCredentials);

    const server = createMcpServer(activeGateway, config.PUBLIC_URL);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  return app;
}
