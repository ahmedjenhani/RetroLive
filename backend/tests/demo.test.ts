import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, type DemoResponse, type JoinResponse } from '@retrolive/shared';
import {
  FakeLlm,
  connectClient,
  createSession,
  joinAsGuest,
  registerHost,
  resetDb,
  startBackend,
  type TestBackend,
} from './helpers';

let backend: TestBackend;
let llm: FakeLlm;

beforeAll(async () => {
  llm = new FakeLlm();
  backend = await startBackend({ llm });
});
afterAll(async () => {
  await backend.close();
});
beforeEach(async () => {
  await resetDb(backend.prisma);
  llm.calls = [];
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function newDemo(api: TestBackend['api'] = backend.api): Promise<DemoResponse> {
  const res = await api.post('/api/demo').expect(201);
  return res.body as DemoResponse;
}

async function enter(demo: DemoResponse): Promise<JoinResponse> {
  const res = await backend.api.post(`/api/sessions/${demo.sessionId}/enter`).set(auth(demo.token)).expect(200);
  return res.body as JoinResponse;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

describe('creating a demo', () => {
  it('gives the visitor a signed-in demo host and a ready-made board', async () => {
    const demo = await newDemo();
    expect(demo.user).toMatchObject({ name: 'Demo Host', isDemo: true });
    expect(demo.user.email).toMatch(/@demo\.invalid$/);

    const me = await backend.api.get('/api/auth/me').set(auth(demo.token)).expect(200);
    expect(me.body.isDemo).toBe(true);

    const list = await backend.api.get('/api/sessions').set(auth(demo.token)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: demo.sessionId,
      title: 'Sprint 42 retrospective (demo)',
      phase: 'VOTING',
      participantCount: 4, // the host and three teammates
      noteCount: 11,
    });
  });

  it('starts in the voting phase with sample votes, and the visitor has all 3 of their own votes left', async () => {
    const demo = await newDemo();
    const joined = await enter(demo);
    const { socket, state } = await connectClient(backend.url, joined.token);
    try {
      expect(state.session.phase).toBe('VOTING');
      expect(state.me).toMatchObject({ isHost: true, nickname: 'Demo Host', votesLeft: LIMITS.MAX_VOTES, myVotes: [] });
      expect(state.notes).toHaveLength(11);

      const votes = (fragment: string) => state.notes.find((n) => n.text.includes(fragment))?.voteCount;
      expect(votes('Deployments take over')).toBe(3);
      expect(votes('Code reviews wait')).toBe(2);
      expect(votes('Pair programming')).toBe(1);
      expect(votes('Daily standups')).toBe(0);
      expect(new Set(state.notes.map((n) => n.authorNickname))).toEqual(new Set(['Demo Host', 'Gina', 'Sam', 'Lee']));
      expect(new Set(state.notes.map((n) => n.column))).toEqual(new Set(['WENT_WELL', 'TO_IMPROVE', 'ACTION_IDEAS']));
    } finally {
      socket.close();
    }
  });

  it('lets the visitor really use the demo: vote (3 at most), move on, and get an AI summary', async () => {
    const demo = await newDemo();
    const { socket, state } = await connectClient(backend.url, (await enter(demo)).token);
    try {
      const ids = state.notes.slice(0, 4).map((n) => n.id);
      for (const id of ids.slice(0, 3)) {
        expect(await socket.emitWithAck('vote:add', { noteId: id })).toMatchObject({ ok: true });
      }
      expect(await socket.emitWithAck('vote:add', { noteId: ids[3] as string })).toMatchObject({
        ok: false,
        error: { code: 'LIMIT_REACHED' },
      });

      expect(await socket.emitWithAck('host:set-phase', { phase: 'DISCUSSING' })).toMatchObject({ ok: true });
      const res = await backend.api.post(`/api/sessions/${demo.sessionId}/summary`).set(auth(demo.token)).expect(200);
      expect(res.body.themes.length).toBeGreaterThan(0);
      expect(llm.calls).toHaveLength(1);
      expect(llm.calls[0]?.user).toContain('Deployments take over 40 minutes');
    } finally {
      socket.close();
    }
  });

  it('lets other people join the demo with its code', async () => {
    const demo = await newDemo();
    const code = (await backend.prisma.retroSession.findUniqueOrThrow({ where: { id: demo.sessionId } })).code;
    const guest = await joinAsGuest(backend.api, code, 'Visitor friend');
    expect(guest.session.id).toBe(demo.sessionId);
  });

  it('keeps every demo private: another visitor\'s changes never show up', async () => {
    const one = await newDemo();
    const two = await newDemo();
    expect(two.sessionId).not.toBe(one.sessionId);
    expect(two.user.id).not.toBe(one.user.id);

    const codeOne = (await backend.prisma.retroSession.findUniqueOrThrow({ where: { id: one.sessionId } })).code;
    const guest = await joinAsGuest(backend.api, codeOne, 'Intruder');
    await backend.prisma.note.create({
      data: { sessionId: one.sessionId, participantId: guest.participant.id, column: 'WENT_WELL', text: 'Only in demo one' },
    });

    const listTwo = await backend.api.get('/api/sessions').set(auth(two.token)).expect(200);
    expect(listTwo.body[0]).toMatchObject({ noteCount: 11, participantCount: 4 });
    // and one visitor cannot open another visitor's demo
    await backend.api.get(`/api/sessions/${one.sessionId}`).set(auth(two.token)).expect(404);
  });
});

describe('demo accounts', () => {
  it('cannot be signed into with a password, whatever is tried', async () => {
    const demo = await newDemo();
    for (const password of ['', 'password', 'Password123!', 'demo']) {
      await backend.api.post('/api/auth/login').send({ email: demo.user.email, password: password || 'x' }).expect(401);
    }
  });

  it('are flagged, so ordinary accounts are never mistaken for them', async () => {
    const host = await registerHost(backend.api);
    const me = await backend.api.get('/api/auth/me').set(auth(host.token)).expect(200);
    expect(me.body.isDemo).toBe(false);
    const rows = await backend.prisma.user.findMany({ select: { isDemo: true } });
    expect(rows.every((r) => r.isDemo === false)).toBe(true);
  });
});

describe('limits', () => {
  it('allows 5 demos an hour per visitor, then answers 429', async () => {
    const limited = await startBackend({ config: { rateLimitsEnabled: true } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < LIMITS.DEMOS_PER_HOUR_PER_IP + 1; i++) {
        statuses.push((await limited.api.post('/api/demo')).status);
      }
      expect(statuses.slice(0, LIMITS.DEMOS_PER_HOUR_PER_IP).every((s) => s === 201)).toBe(true);
      expect(statuses[LIMITS.DEMOS_PER_HOUR_PER_IP]).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('refuses to create more once too many demos exist at once', async () => {
    await backend.prisma.user.createMany({
      data: Array.from({ length: LIMITS.DEMO_MAX_ACTIVE }, (_, i) => ({
        email: `bulk-${i}@demo.invalid`,
        name: 'Demo Host',
        passwordHash: 'x',
        isDemo: true,
      })),
    });
    const res = await backend.api.post('/api/demo').expect(429);
    expect(res.body.error.message).toContain('very busy');
    expect(await backend.prisma.user.count({ where: { isDemo: true } })).toBe(LIMITS.DEMO_MAX_ACTIVE);
  });

  it('frees room by deleting expired demos first when it is at the cap', async () => {
    await backend.prisma.user.createMany({
      data: Array.from({ length: LIMITS.DEMO_MAX_ACTIVE }, (_, i) => ({
        email: `bulk-${i}@demo.invalid`,
        name: 'Demo Host',
        passwordHash: 'x',
        isDemo: true,
        createdAt: i === 0 ? hoursAgo(LIMITS.DEMO_TTL_HOURS + 1) : new Date(),
      })),
    });
    await backend.api.post('/api/demo').expect(201);
    expect(await backend.prisma.user.findUnique({ where: { email: 'bulk-0@demo.invalid' } })).toBeNull();
  });
});

describe('cleanup', () => {
  it('deletes expired demos with everything in them, and leaves everything else alone', async () => {
    const expired = await newDemo();
    const fresh = await newDemo();
    const realHost = await registerHost(backend.api);
    const realSession = await createSession(backend.api, realHost.token, 'A real retro');
    const guest = await joinAsGuest(backend.api, realSession.code, 'Real guest');
    await backend.prisma.note.create({
      data: { sessionId: realSession.id, participantId: guest.participant.id, column: 'WENT_WELL', text: 'Keep me' },
    });
    // an old ordinary account must never be touched, however old it is
    await backend.prisma.user.update({ where: { id: realHost.id }, data: { createdAt: hoursAgo(24 * 365) } });
    await backend.prisma.user.update({ where: { id: expired.user.id }, data: { createdAt: hoursAgo(LIMITS.DEMO_TTL_HOURS + 1) } });

    expect(await backend.demo.cleanup()).toBe(1);

    expect(await backend.prisma.user.findUnique({ where: { id: expired.user.id } })).toBeNull();
    expect(await backend.prisma.retroSession.count({ where: { id: expired.sessionId } })).toBe(0);
    expect(await backend.prisma.participant.count({ where: { sessionId: expired.sessionId } })).toBe(0);
    expect(await backend.prisma.note.count({ where: { sessionId: expired.sessionId } })).toBe(0);
    // the demo's votes went with its notes, so only the other demo's 8 votes remain
    expect(await backend.prisma.vote.count()).toBe(8);

    expect(await backend.prisma.user.findUnique({ where: { id: fresh.user.id } })).not.toBeNull();
    expect(await backend.prisma.note.count({ where: { sessionId: fresh.sessionId } })).toBe(11);
    expect(await backend.prisma.user.findUnique({ where: { id: realHost.id } })).not.toBeNull();
    expect(await backend.prisma.note.count({ where: { sessionId: realSession.id } })).toBe(1);
  });

  it('does nothing when nothing has expired', async () => {
    await newDemo();
    expect(await backend.demo.cleanup()).toBe(0);
    expect(await backend.prisma.user.count({ where: { isDemo: true } })).toBe(1);
  });

  it('keeps a demo that is just inside its time limit, and removes one just past it', async () => {
    const inside = await newDemo();
    const outside = await newDemo();
    await backend.prisma.user.update({ where: { id: inside.user.id }, data: { createdAt: hoursAgo(LIMITS.DEMO_TTL_HOURS - 0.1) } });
    await backend.prisma.user.update({ where: { id: outside.user.id }, data: { createdAt: hoursAgo(LIMITS.DEMO_TTL_HOURS + 0.1) } });
    expect(await backend.demo.cleanup()).toBe(1);
    expect(await backend.prisma.user.findUnique({ where: { id: inside.user.id } })).not.toBeNull();
    expect(await backend.prisma.user.findUnique({ where: { id: outside.user.id } })).toBeNull();
  });

  it('disconnects anyone still looking at an expired demo board', async () => {
    const demo = await newDemo();
    const { socket } = await connectClient(backend.url, (await enter(demo)).token);
    const disconnected = new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
    await backend.prisma.user.update({ where: { id: demo.user.id }, data: { createdAt: hoursAgo(LIMITS.DEMO_TTL_HOURS + 1) } });

    await backend.demo.cleanup();
    await disconnected;
  });

  it('runs on its own once started, and stops when told to', async () => {
    const demo = await newDemo();
    await backend.prisma.user.update({ where: { id: demo.user.id }, data: { createdAt: hoursAgo(LIMITS.DEMO_TTL_HOURS + 1) } });

    const stop = backend.demo.startCleanup(60 * 60 * 1000);
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && (await backend.prisma.user.count({ where: { id: demo.user.id } })) > 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(await backend.prisma.user.count({ where: { id: demo.user.id } })).toBe(0);
    } finally {
      stop();
    }
  });
});
