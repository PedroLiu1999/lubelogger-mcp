import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { UserCredentials } from '../gateway/types.js';

export type { UserCredentials };

export interface EncryptedCredentials {
  iv: string;
  tag: string;
  data: string;
}

export interface StoredToken {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: string;
  userCredentials?: UserCredentials;
}

export type StoredAccessToken = StoredToken;
export type StoredRefreshToken = StoredToken;

interface SerializedStoredToken {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: string;
  encryptedCredentials?: EncryptedCredentials;
  userCredentials?: UserCredentials; // for legacy disk read backwards compatibility
}

interface SerializedTokenStoreData {
  accessTokens: SerializedStoredToken[];
  refreshTokens: SerializedStoredToken[];
  clients?: OAuthClientInformationFull[];
}

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
export const MAX_REGISTERED_CLIENTS = 20;

export function getOrCreateEncryptionKey(dataDir: string): Buffer {
  if (process.env.TOKEN_ENCRYPTION_KEY) {
    return createHash('sha256').update(process.env.TOKEN_ENCRYPTION_KEY, 'utf8').digest();
  }
  const keyPath = path.join(dataDir, '.token_encryption_key');
  if (fs.existsSync(keyPath)) {
    try {
      const existing = fs.readFileSync(keyPath);
      if (existing.length === 32) {
        return existing;
      }
    } catch {
      // Regenerate key if read fails
    }
  }
  const newKey = randomBytes(32);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
  } catch {
    // In memory fallback if disk write is disallowed
  }
  return newKey;
}

export function encryptCredentials(creds: UserCredentials, key: Buffer): EncryptedCredentials {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(creds);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('base64'),
  };
}

export function decryptCredentials(encrypted: EncryptedCredentials, key: Buffer): UserCredentials | undefined {
  try {
    const iv = Buffer.from(encrypted.iv, 'hex');
    const tag = Buffer.from(encrypted.tag, 'hex');
    const data = Buffer.from(encrypted.data, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as UserCredentials;
  } catch {
    return undefined;
  }
}

function hydrateTokens(
  items: unknown,
  target: Map<string, StoredToken>,
  nowSeconds: number,
  encryptionKey: Buffer,
): void {
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (
      item &&
      typeof item === 'object' &&
      typeof item.token === 'string' &&
      typeof item.clientId === 'string' &&
      typeof item.expiresAt === 'number' &&
      item.expiresAt > nowSeconds
    ) {
      let userCredentials: UserCredentials | undefined;

      const rawEncrypted = (item as any).encryptedCredentials;
      if (
        rawEncrypted &&
        typeof rawEncrypted.iv === 'string' &&
        typeof rawEncrypted.tag === 'string' &&
        typeof rawEncrypted.data === 'string'
      ) {
        userCredentials = decryptCredentials(rawEncrypted, encryptionKey);
      } else {
        // Fallback for reading legacy plaintext records
        const rawCreds = (item as any).userCredentials;
        if (rawCreds && typeof rawCreds === 'object') {
          userCredentials = {
            apiKey: typeof rawCreds.apiKey === 'string' ? rawCreds.apiKey : undefined,
            username: typeof rawCreds.username === 'string' ? rawCreds.username : undefined,
            password: typeof rawCreds.password === 'string' ? rawCreds.password : undefined,
          };
        }
      }

      target.set(item.token, {
        token: item.token,
        clientId: item.clientId,
        scopes: Array.isArray(item.scopes) ? item.scopes : ['mcp:tools'],
        expiresAt: item.expiresAt,
        resource: typeof item.resource === 'string' ? item.resource : undefined,
        userCredentials,
      });
    }
  }
}

function evictExpiredTokens(
  store: Map<string, StoredToken>,
  nowSeconds: number,
): void {
  for (const [key, val] of store.entries()) {
    if (val.expiresAt <= nowSeconds) {
      store.delete(key);
    }
  }
}

function getValidToken(
  store: Map<string, StoredToken>,
  token: string,
): StoredToken | undefined {
  const record = store.get(token);
  if (!record) {
    return undefined;
  }
  if (record.expiresAt <= Math.floor(Date.now() / 1000)) {
    store.delete(token);
    return undefined;
  }
  return record;
}

export class FileTokenStore {
  private readonly filePath: string;
  private readonly dataDir: string;
  private readonly encryptionKey: Buffer;
  private readonly accessTokens = new Map<string, StoredAccessToken>();
  private readonly refreshTokens = new Map<string, StoredRefreshToken>();
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'oauth-tokens.json');
    this.encryptionKey = getOrCreateEncryptionKey(dataDir);
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SerializedTokenStoreData>;
      const nowSeconds = Math.floor(Date.now() / 1000);

      hydrateTokens(parsed.accessTokens, this.accessTokens, nowSeconds, this.encryptionKey);
      hydrateTokens(parsed.refreshTokens, this.refreshTokens, nowSeconds, this.encryptionKey);

      if (Array.isArray(parsed.clients)) {
        for (const client of parsed.clients) {
          if (client && typeof client.client_id === 'string') {
            this.clients.set(client.client_id, client);
          }
        }
      }
    } catch {
      // Ignore corrupt or empty state file and start fresh
    }
  }

  private serializeToken(token: StoredToken): SerializedStoredToken {
    const serialized: SerializedStoredToken = {
      token: token.token,
      clientId: token.clientId,
      scopes: token.scopes,
      expiresAt: token.expiresAt,
      resource: token.resource,
    };

    if (
      token.userCredentials &&
      (token.userCredentials.apiKey ||
        (token.userCredentials.username && token.userCredentials.password))
    ) {
      serialized.encryptedCredentials = encryptCredentials(
        token.userCredentials,
        this.encryptionKey,
      );
    }

    return serialized;
  }

  private persistToDisk(): void {
    const nowSeconds = Math.floor(Date.now() / 1000);
    evictExpiredTokens(this.accessTokens, nowSeconds);
    evictExpiredTokens(this.refreshTokens, nowSeconds);

    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const payload: SerializedTokenStoreData = {
        accessTokens: Array.from(this.accessTokens.values()).map((t) => this.serializeToken(t)),
        refreshTokens: Array.from(this.refreshTokens.values()).map((t) => this.serializeToken(t)),
        clients: Array.from(this.clients.values()),
      };

      const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error(
        `[tokenStore] ⚠️ Failed to persist token store to disk (${this.filePath}):`,
        err,
      );
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  saveClient(client: OAuthClientInformationFull): void {
    if (!this.clients.has(client.client_id) && this.clients.size >= MAX_REGISTERED_CLIENTS) {
      const oldestClientId = this.clients.keys().next().value;
      if (oldestClientId) {
        this.clients.delete(oldestClientId);
        for (const [token, record] of this.accessTokens.entries()) {
          if (record.clientId === oldestClientId) {
            this.accessTokens.delete(token);
          }
        }
        for (const [token, record] of this.refreshTokens.entries()) {
          if (record.clientId === oldestClientId) {
            this.refreshTokens.delete(token);
          }
        }
      }
    }
    this.clients.delete(client.client_id);
    this.clients.set(client.client_id, client);
    this.persistToDisk();
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      this.clients.set(clientId, client);
    }
    return client;
  }

  saveTokens(access: StoredAccessToken, refresh?: StoredRefreshToken): void {
    this.accessTokens.set(access.token, access);
    if (refresh) {
      this.refreshTokens.set(refresh.token, refresh);
    }
    this.persistToDisk();
  }

  getAccessToken(token: string): StoredAccessToken | undefined {
    return getValidToken(this.accessTokens, token);
  }

  getUserCredentials(token: string): UserCredentials | undefined {
    const record = getValidToken(this.accessTokens, token);
    return record?.userCredentials;
  }

  getRefreshToken(token: string): StoredRefreshToken | undefined {
    return getValidToken(this.refreshTokens, token);
  }

  revokeToken(clientId: string, token: string): void {
    let changed = false;
    const access = this.accessTokens.get(token);
    if (access && access.clientId === clientId) {
      this.accessTokens.delete(token);
      changed = true;
    }
    const refresh = this.refreshTokens.get(token);
    if (refresh && refresh.clientId === clientId) {
      this.refreshTokens.delete(token);
      changed = true;
    }
    if (changed) {
      this.persistToDisk();
    }
  }
}
