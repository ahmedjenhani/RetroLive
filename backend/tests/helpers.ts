import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import type {
  ClientToServerEvents,
  JoinResponse,
  ServerToClientEvents,
  SessionInfo,
  SessionState,
} from '@retrolive/shared';
import type { GenerateJsonRequest, LlmClient } from '../src/ai/llm';
import { createBackend } from '../src/bootstrap';
import type { Config } from '../src/config';

export const TEST_SECRET = 'test-secret-that-is-definitely-more-than-32-chars';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl: process.env['DATABASE_URL'] as string,
    jwtSecret: TEST_SECRET,
    corsOrigins: ['http://localhost:5173'],
    gemini: { apiKey: '', model: 'primary', fallbackModel: 'fallback', baseUrl: 'http://gemini.test' },
    bcryptRounds: 4,
    rateLimitsEnabled: false,
    trustProxy: 0,
    ...overrides,
  };
}

/** A pretend AI provider: records what it was asked and answers from a function the test controls. */
export class FakeLlm implements LlmClient {
  calls: GenerateJsonRequest[] = [];
  respond: (request: GenerateJsonRequest) => unknown = (request) => {
    const ids = [...request.user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1] as string);
    return {
      themes: [{ title: 'Delivery pace', summary: 'The team ships steadily.', noteIds: ids.slice(0, 2) }],
      actionItems: ['Write a shared definition of done', 'Pair on the slowest review'],
    };
  };

  async generateJson(request: GenerateJsonRequest): Promise<unknown> {
    this.calls.push(request);
    return this.respond(request);
  }
}

export async function startBackend(options: { config?: Partial<Config>; llm?: LlmClient; floodGuard?: boolean } = {}) {
  const config = testConfig(options.config);
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
  const backend = createBackend({ config, prisma, llm: options.llm, floodGuard: options.floodGuard ?? false });
  await new Promise<void>((resolve) => backend.httpServer.listen(0, '127.0.0.1', resolve));
  const port = (backend.httpServer.address() as AddressInfo).port;
  return { ...backend, url: `http://127.0.0.1:${port}`, api: request(backend.app) };
}
export type TestBackend = Awaited<ReturnType<typeof startBackend>>;

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE "Vote","Note","Participant","RetroSession","User" RESTART IDENTITY CASCADE');
}

let counter = 0;
export async function registerHost(api: TestBackend['api'], name = 'Hannah Host'): Promise<{ token: string; id: string }> {
  counter += 1;
  const res = await api
    .post('/api/auth/register')
    .send({ name, email: `host${counter}-${Date.now()}@example.com`, password: 'Password123!' })
    .expect(201);
  return { token: res.body.token as string, id: res.body.user.id as string };
}

export async function createSession(api: TestBackend['api'], hostToken: string, title = 'Sprint 42'): Promise<SessionInfo> {
  const res = await api.post('/api/sessions').set('Authorization', `Bearer ${hostToken}`).send({ title }).expect(201);
  return res.body as SessionInfo;
}

export async function enterAsHost(api: TestBackend['api'], hostToken: string, sessionId: string): Promise<JoinResponse> {
  const res = await api.post(`/api/sessions/${sessionId}/enter`).set('Authorization', `Bearer ${hostToken}`).expect(200);
  return res.body as JoinResponse;
}

export async function joinAsGuest(api: TestBackend['api'], code: string, nickname: string): Promise<JoinResponse> {
  const res = await api.post('/api/join').send({ code, nickname }).expect(201);
  return res.body as JoinResponse;
}

// ---------------------------------------------------------------- socket helpers

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Connects with a participant token and resolves once the first full state has arrived. */
export async function connectClient(url: string, token: string): Promise<{ socket: ClientSocket; state: SessionState }> {
  const socket: ClientSocket = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  const state = await new Promise<SessionState>((resolve, reject) => {
    socket.once('state', resolve);
    socket.once('connect_error', (err) => reject(err));
    setTimeout(() => reject(new Error('timed out waiting for the first state')), 5000);
  });
  return { socket, state };
}

/** Resolves with the next matching event; fails the test (instead of hanging) if it never arrives. */
export function nextEvent<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  predicate: (...args: Parameters<ServerToClientEvents[E]>) => boolean = () => true,
  timeoutMs = 3000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      reject(new Error(`timed out waiting for "${String(event)}"`));
    }, timeoutMs);
    const handler = (...args: Parameters<ServerToClientEvents[E]>): void => {
      if (predicate(...args)) {
        clearTimeout(timer);
        socket.off(event, handler as never);
        resolve(args[0]);
      }
    };
    socket.on(event, handler as never);
  });
}

/** Asserts that an event does NOT arrive within a short window. */
export async function expectNoEvent(socket: ClientSocket, event: keyof ServerToClientEvents, windowMs = 300): Promise<void> {
  let received = false;
  const handler = (): void => {
    received = true;
  };
  socket.on(event, handler as never);
  await new Promise((r) => setTimeout(r, windowMs));
  socket.off(event, handler as never);
  if (received) {
    throw new Error(`unexpected "${String(event)}" event`);
  }
}

/** Everything a test needs: a host and guests, all connected to one fresh session. */
export async function setupRoom(backend: TestBackend, guestNames: string[] = ['Gina']) {
  const host = await registerHost(backend.api);
  const session = await createSession(backend.api, host.token);
  const hostJoin = await enterAsHost(backend.api, host.token, session.id);
  const hostClient = await connectClient(backend.url, hostJoin.token);

  const guests: { nickname: string; join: JoinResponse; socket: ClientSocket; state: SessionState }[] = [];
  for (const nickname of guestNames) {
    const join = await joinAsGuest(backend.api, session.code, nickname);
    const client = await connectClient(backend.url, join.token);
    guests.push({ nickname, join, ...client });
  }
  return {
    host,
    session,
    hostJoin,
    hostSocket: hostClient.socket,
    hostState: hostClient.state,
    guests,
    sockets: () => [hostClient.socket, ...guests.map((g) => g.socket)],
    closeAll: () => [hostClient.socket, ...guests.map((g) => g.socket)].forEach((s) => s.close()),
  };
}
