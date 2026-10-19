import http from 'node:http';
import { PrismaClient } from '@prisma/client';
import { LIMITS } from '@retrolive/shared';
import { GeminiClient } from './ai/gemini';
import { DisabledLlm, type LlmClient } from './ai/llm';
import { createApp } from './app';
import { TokenService } from './auth/tokens';
import type { Config } from './config';
import { SocketHub } from './realtime/hub';
import { attachRealtime } from './realtime/socket';
import { RetroService } from './retro/service';
import { SessionService } from './sessions/service';
import { SlidingWindowLimiter } from './util/rateLimiter';

export interface BackendOptions {
  config: Config;
  prisma?: PrismaClient;
  /** Swap the AI provider (tests pass a fake one). */
  llm?: LlmClient;
  floodGuard?: boolean;
}

/** Wires everything together. The server and the tests both start the app through this one function. */
export function createBackend({ config, prisma = new PrismaClient({ datasourceUrl: config.databaseUrl }), llm, floodGuard }: BackendOptions) {
  const tokens = new TokenService(config.jwtSecret);
  const noteLimiter = new SlidingWindowLimiter(LIMITS.NOTES_PER_MINUTE, 60_000);
  const retro = new RetroService(prisma, config.rateLimitsEnabled ? noteLimiter : null);
  const sessions = new SessionService(prisma, tokens);
  const hub = new SocketHub();

  const aiClient: LlmClient =
    llm ??
    (config.gemini.apiKey
      ? new GeminiClient({
          apiKey: config.gemini.apiKey,
          model: config.gemini.model,
          fallbackModel: config.gemini.fallbackModel,
          baseUrl: config.gemini.baseUrl,
        })
      : new DisabledLlm());

  const app = createApp({ config, prisma, tokens, sessions, retro, llm: aiClient, hub });
  const httpServer = http.createServer(app);
  const io = attachRealtime({ httpServer, corsOrigins: config.corsOrigins, tokens, retro, hub, floodGuard });

  async function close(): Promise<void> {
    await io.close();
    if (httpServer.listening) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    await prisma.$disconnect();
  }

  return { app, httpServer, io, prisma, tokens, retro, sessions, close };
}
