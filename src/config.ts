import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

const redirectUriSchema = z.string().url().refine((val) => {
  try {
    const url = new URL(val);
    if (LOOPBACK_HOSTS.has(url.hostname)) {
      return url.protocol === 'http:' || url.protocol === 'https:';
    }
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}, {
  message: 'Redirect URIs must use https:// unless targeting loopback (localhost or 127.0.0.1)',
});

export const DEFAULT_ALLOWED_REDIRECT_URIS = [
  'http://localhost',
  'http://127.0.0.1',
];

const configSchema = z
  .object({
    PUBLIC_URL: z
      .string()
      .trim()
      .url()
      .transform((url) => url.replace(/\/+$/, '')),
    LOGO_URL: z
      .string()
      .trim()
      .url()
      .optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATA_DIR: nonEmptyString,
    OAUTH_ALLOWED_REDIRECT_URIS: z
      .string()
      .default(DEFAULT_ALLOWED_REDIRECT_URIS.join(','))
      .transform((raw) => {
        if (!raw || raw.trim() === '') return DEFAULT_ALLOWED_REDIRECT_URIS;
        return raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      })
      .pipe(z.array(redirectUriSchema)),
    LUBELOGGER_URL: z
      .string()
      .trim()
      .url()
      .transform((url) => url.replace(/\/+$/, '')),
    LUBELOGGER_API_KEY: z
      .string()
      .trim()
      .optional(),
    LUBELOGGER_USERNAME: z
      .string()
      .trim()
      .optional(),
    LUBELOGGER_PASSWORD: z
      .string()
      .trim()
      .optional(),
    CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(30),
  })
  .refine(
    (cfg) => {
      if (cfg.LUBELOGGER_USERNAME && !cfg.LUBELOGGER_PASSWORD) return false;
      if (!cfg.LUBELOGGER_USERNAME && cfg.LUBELOGGER_PASSWORD) return false;
      return true;
    },
    {
      message: 'Both LUBELOGGER_USERNAME and LUBELOGGER_PASSWORD must be provided if using basic auth',
      path: ['LUBELOGGER_PASSWORD'],
    },
  );

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid startup configuration: ${details}`);
  }
  return result.data;
}
