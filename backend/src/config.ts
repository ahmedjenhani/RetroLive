import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Local development reads the git-ignored .env at the repository root.
// In production (Render, Docker) the same names come from real environment variables.
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const booleanFromString = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** Comma-separated list of browser origins allowed to call the API. */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_BASE_URL: z.string().default('https://generativelanguage.googleapis.com'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(14).default(10),
  RATE_LIMITS_ENABLED: booleanFromString,
  /** Number of reverse proxies in front of the app (Render has one). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).optional(),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigins: string[];
  gemini: { apiKey: string; model: string; fallbackModel: string; baseUrl: string };
  bcryptRounds: number;
  rateLimitsEnabled: boolean;
  trustProxy: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const e = result.data;
  const production = e.NODE_ENV === 'production';
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    corsOrigins: e.CORS_ORIGIN.split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    gemini: {
      apiKey: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL,
      fallbackModel: e.GEMINI_FALLBACK_MODEL,
      baseUrl: e.GEMINI_BASE_URL.replace(/\/+$/, ''),
    },
    bcryptRounds: e.BCRYPT_ROUNDS,
    rateLimitsEnabled: e.RATE_LIMITS_ENABLED ?? e.NODE_ENV !== 'test',
    trustProxy: e.TRUST_PROXY ?? (production ? 1 : 0),
  };
}
