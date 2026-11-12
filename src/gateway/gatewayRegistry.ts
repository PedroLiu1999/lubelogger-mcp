import { createHash } from 'node:crypto';
import {
  createLubeLoggerGateway,
  DefaultLubeLoggerGateway,
  type LubeLoggerGatewayOptions,
} from './lubeLoggerGateway.js';
import type {
  LubeLoggerGateway,
  ServerReadiness,
  UserCredentials,
} from './types.js';

export interface GatewayRegistryOptions {
  serverUrl: string;
  cacheTtlSeconds?: number;
  fetchFn?: typeof fetch;
  defaultCredentials?: UserCredentials;
  defaultGateway?: LubeLoggerGateway;
}

export class GatewayRegistry {
  private readonly serverUrl: string;
  private readonly cacheTtlSeconds?: number;
  private readonly fetchFn?: typeof fetch;
  private readonly defaultGateway: LubeLoggerGateway;
  private readonly pool = new Map<string, LubeLoggerGateway>();

  constructor(options: GatewayRegistryOptions) {
    this.serverUrl = options.serverUrl;
    this.cacheTtlSeconds = options.cacheTtlSeconds;
    this.fetchFn = options.fetchFn;
    this.defaultGateway =
      options.defaultGateway ??
      createLubeLoggerGateway({
        serverUrl: options.serverUrl,
        apiKey: options.defaultCredentials?.apiKey,
        username: options.defaultCredentials?.username,
        password: options.defaultCredentials?.password,
        cacheTtlSeconds: options.cacheTtlSeconds,
        fetchFn: options.fetchFn,
      });
  }

  async initialize(): Promise<void> {
    await this.defaultGateway.initialize();
  }

  async shutdown(): Promise<void> {
    await this.defaultGateway.shutdown();
    for (const gw of this.pool.values()) {
      await gw.shutdown();
    }
    this.pool.clear();
  }

  getReadiness(): ServerReadiness {
    return this.defaultGateway.getReadiness();
  }

  getDefaultGateway(): LubeLoggerGateway {
    return this.defaultGateway;
  }

  getGateway(credentials?: UserCredentials): LubeLoggerGateway {
    if (!credentials || (!credentials.apiKey && (!credentials.username || !credentials.password))) {
      return this.defaultGateway;
    }

    if (this.defaultGateway && !(this.defaultGateway instanceof DefaultLubeLoggerGateway)) {
      return this.defaultGateway;
    }

    const key = this.hashCredentials(credentials);
    const existing = this.pool.get(key);
    if (existing) {
      return existing;
    }

    const gateway = createLubeLoggerGateway({
      serverUrl: this.serverUrl,
      apiKey: credentials.apiKey,
      username: credentials.username,
      password: credentials.password,
      cacheTtlSeconds: this.cacheTtlSeconds,
      fetchFn: this.fetchFn,
    });
    // Trigger lazy background vehicle caching without blocking current request
    void gateway.initialize();
    this.pool.set(key, gateway);
    return gateway;
  }

  private hashCredentials(creds: UserCredentials): string {
    const raw = creds.apiKey ? `key:${creds.apiKey}` : `basic:${creds.username}:${creds.password}`;
    return createHash('sha256').update(raw).digest('hex');
  }
}

export function createGatewayRegistry(options: GatewayRegistryOptions): GatewayRegistry {
  return new GatewayRegistry(options);
}
