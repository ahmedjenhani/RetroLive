import { ZodError } from 'zod';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { PrismaClient } from '@prisma/client';
import type { LlmClient } from './ai/llm';
import { authRoutes } from './auth/routes';
import type { TokenService } from './auth/tokens';
import type { Config } from './config';
import type { RealtimeHub } from './realtime/hub';
import type { RetroService } from './retro/service';
import { joinRoutes, sessionRoutes } from './sessions/routes';
import type { SessionService } from './sessions/service';
import { AppError } from './util/errors';

export interface AppDeps {
  config: Config;
  prisma: PrismaClient;
  tokens: TokenService;
  sessions: SessionService;
  retro: RetroService;
  llm: LlmClient;
  hub: RealtimeHub;
}

export function createApp(deps: AppDeps): Express {
  const { config, prisma, tokens, sessions, retro, llm, hub } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      exposedHeaders: ['Retry-After'],
      maxAge: 3600,
    }),
  );
  app.use(express.json({ limit: '50kb' }));

  // Cheap on purpose: the host platform polls this, and it must not wake the database up.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/health/ready', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  });

  // Per IP address. Sign-in is strict because it can be guessed at; joining is generous because a whole team
  // sitting behind one office or school network arrives from the same address at the same moment.
  const limiter = (limit: number, message: string) =>
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => !config.rateLimitsEnabled,
      handler: (_req, res) => {
        res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
      },
    });
  const authLimiter = limiter(20, 'Too many attempts, please wait a minute');
  const joinLimiter = limiter(240, 'Too many requests from your network, please wait a moment');

  app.use('/api/auth', authLimiter, authRoutes(prisma, tokens, config.bcryptRounds));
  app.use('/api/join', joinLimiter, joinRoutes(sessions));
  app.use('/api/sessions', sessionRoutes({ prisma, tokens, sessions, retro, llm, hub }));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
      if (err.retryAfterSeconds) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid input' } });
      return;
    }
    // malformed JSON from body-parser and similar client mistakes
    if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
      res.status(err.status).json({ error: { code: 'VALIDATION', message: 'Malformed request' } });
      return;
    }
    console.error('[http] unexpected error', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  };
  app.use(onError);

  return app;
}
