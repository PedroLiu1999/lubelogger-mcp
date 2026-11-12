import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const baseValidEnv = {
    PUBLIC_URL: 'https://lubelogger-mcp.example.com/',
    DATA_DIR: '/tmp/lubelogger-test-data',
    LUBELOGGER_URL: 'http://localhost:8383/',
  };

  it('loads valid configuration using LUBELOGGER_API_KEY', () => {
    const config = loadConfig({
      ...baseValidEnv,
      LUBELOGGER_API_KEY: 'test-api-key-123',
    });

    expect(config.PUBLIC_URL).toBe('https://lubelogger-mcp.example.com');
    expect(config.LUBELOGGER_URL).toBe('http://localhost:8383');
    expect(config.LUBELOGGER_API_KEY).toBe('test-api-key-123');
    expect(config.PORT).toBe(3000);
    expect(config.CACHE_TTL_SECONDS).toBe(30);
    expect(config.OAUTH_ALLOWED_REDIRECT_URIS).toContain('http://localhost');
  });

  it('loads valid configuration using Basic Auth credentials', () => {
    const config = loadConfig({
      ...baseValidEnv,
      LUBELOGGER_USERNAME: 'admin',
      LUBELOGGER_PASSWORD: 'password123',
    });

    expect(config.LUBELOGGER_USERNAME).toBe('admin');
    expect(config.LUBELOGGER_PASSWORD).toBe('password123');
    expect(config.LUBELOGGER_API_KEY).toBeUndefined();
  });

  it('loads valid configuration in dynamic auth mode with zero env secrets', () => {
    const config = loadConfig({
      PUBLIC_URL: 'https://lubelogger-mcp.example.com/',
      DATA_DIR: '/tmp/lubelogger-test-data',
      LUBELOGGER_URL: 'http://localhost:8383/',
    });

    expect(config.PUBLIC_URL).toBe('https://lubelogger-mcp.example.com');
    expect(config.LUBELOGGER_URL).toBe('http://localhost:8383');
    expect(config.LUBELOGGER_API_KEY).toBeUndefined();
    expect(config.LUBELOGGER_USERNAME).toBeUndefined();
    expect(config.LUBELOGGER_PASSWORD).toBeUndefined();
  });

  it('throws when only username is provided without password', () => {
    expect(() =>
      loadConfig({
        ...baseValidEnv,
        LUBELOGGER_USERNAME: 'admin',
      }),
    ).toThrow(/Both LUBELOGGER_USERNAME and LUBELOGGER_PASSWORD must be provided/);
  });

  it('parses custom port and custom redirect URIs', () => {
    const config = loadConfig({
      ...baseValidEnv,
      LUBELOGGER_API_KEY: 'abc',
      PORT: '8080',
      OAUTH_ALLOWED_REDIRECT_URIS: 'http://localhost,https://oauth-redirect.googleusercontent.com/r/',
    });

    expect(config.PORT).toBe(8080);
    expect(config.OAUTH_ALLOWED_REDIRECT_URIS).toEqual([
      'http://localhost',
      'https://oauth-redirect.googleusercontent.com/r/',
    ]);
  });

  it('rejects invalid redirect URIs using insecure http on non-loopback', () => {
    expect(() =>
      loadConfig({
        ...baseValidEnv,
        LUBELOGGER_API_KEY: 'abc',
        OAUTH_ALLOWED_REDIRECT_URIS: 'http://malicious-site.com/callback',
      }),
    ).toThrow(/Redirect URIs must use https:\/\//);
  });
});
