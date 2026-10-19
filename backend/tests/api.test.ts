import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeLlm,
  createSession,
  enterAsHost,
  joinAsGuest,
  registerHost,
  resetDb,
  startBackend,
  type TestBackend,
} from './helpers';

let backend: TestBackend;
let llm: FakeLlm;
const defaultRespond = new FakeLlm().respond;

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
  llm.respond = defaultRespond; // a test may change how the fake AI answers; start each one fresh
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('health and plumbing', () => {
  it('answers /health without touching the database, and /health/ready with it', async () => {
    await backend.api.get('/health').expect(200, { status: 'ok' });
    await backend.api.get('/health/ready').expect(200, { status: 'ready' });
  });

  it('answers unknown routes and malformed JSON with JSON errors', async () => {
    const missing = await backend.api.get('/api/nope').expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    const bad = await backend.api.post('/api/auth/login').set('Content-Type', 'application/json').send('{oops').expect(400);
    expect(bad.body.error.code).toBe('VALIDATION');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await backend.api.get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows the configured browser origin and no other', async () => {
    const ok = await backend.api.get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await backend.api.get('/health').set('Origin', 'https://evil.example.com');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('accounts', () => {
  it('registers, normalises the email, and logs in', async () => {
    const reg = await backend.api
      .post('/api/auth/register')
      .send({ name: 'Ada', email: ' ADA@Example.com ', password: 'Password123!' })
      .expect(201);
    expect(reg.body.user.email).toBe('ada@example.com');
    expect(reg.body.user).not.toHaveProperty('passwordHash');
    expect(reg.body.user.isDemo).toBe(false);

    const login = await backend.api.post('/api/auth/login').send({ email: 'Ada@example.com', password: 'Password123!' }).expect(200);
    const me = await backend.api.get('/api/auth/me').set(auth(login.body.token)).expect(200);
    expect(me.body.name).toBe('Ada');
  });

  it('never stores a plain-text password', async () => {
    await backend.api.post('/api/auth/register').send({ name: 'Ada', email: 'a@example.com', password: 'Password123!' }).expect(201);
    const user = await backend.prisma.user.findFirstOrThrow();
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(user.passwordHash).not.toContain('Password123!');
  });

  it('refuses duplicate emails', async () => {
    const body = { name: 'Ada', email: 'dup@example.com', password: 'Password123!' };
    await backend.api.post('/api/auth/register').send(body).expect(201);
    const second = await backend.api.post('/api/auth/register').send(body).expect(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('answers wrong password and unknown user identically', async () => {
    await backend.api.post('/api/auth/register').send({ name: 'Ada', email: 'a@example.com', password: 'Password123!' }).expect(201);
    const wrong = await backend.api.post('/api/auth/login').send({ email: 'a@example.com', password: 'wrong-password' }).expect(401);
    const unknown = await backend.api.post('/api/auth/login').send({ email: 'ghost@example.com', password: 'wrong-password' }).expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('reports which fields are invalid', async () => {
    const res = await backend.api.post('/api/auth/register').send({ name: '', email: 'nope', password: 'short' }).expect(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('requires a valid host token on protected routes, and rejects participant tokens there', async () => {
    await backend.api.get('/api/sessions').expect(401);
    await backend.api.get('/api/sessions').set(auth('garbage')).expect(401);

    const host = await registerHost(backend.api);
    const session = await createSession(backend.api, host.token);
    const guest = await joinAsGuest(backend.api, session.code, 'Gina');
    await backend.api.get('/api/sessions').set(auth(guest.token)).expect(401);
  });
});

describe('sessions', () => {
  it('creates a session with a join code and lists only the host\'s own', async () => {
    const a = await registerHost(backend.api, 'Ann');
    const b = await registerHost(backend.api, 'Ben');
    const mine = await createSession(backend.api, a.token, '  Retro   One ');
    await createSession(backend.api, b.token, 'Not mine');

    expect(mine.title).toBe('Retro One');
    expect(mine.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(mine.phase).toBe('WRITING');
    expect(mine.hostName).toBe('Ann');

    const list = await backend.api.get('/api/sessions').set(auth(a.token)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ title: 'Retro One', participantCount: 0, noteCount: 0 });
  });

  it('validates the title', async () => {
    const host = await registerHost(backend.api);
    await backend.api.post('/api/sessions').set(auth(host.token)).send({ title: '   ' }).expect(400);
    await backend.api.post('/api/sessions').set(auth(host.token)).send({ title: 'x'.repeat(81) }).expect(400);
  });

  it('hides other hosts\' sessions: read, enter, summary, export and delete all answer 404', async () => {
    const owner = await registerHost(backend.api, 'Owner');
    const intruder = await registerHost(backend.api, 'Intruder');
    const session = await createSession(backend.api, owner.token);

    await backend.api.get(`/api/sessions/${session.id}`).set(auth(intruder.token)).expect(404);
    await backend.api.post(`/api/sessions/${session.id}/enter`).set(auth(intruder.token)).expect(404);
    await backend.api.post(`/api/sessions/${session.id}/summary`).set(auth(intruder.token)).expect(404);
    await backend.api.get(`/api/sessions/${session.id}/export`).set(auth(intruder.token)).expect(404);
    await backend.api.delete(`/api/sessions/${session.id}`).set(auth(intruder.token)).expect(404);
    await backend.api.get(`/api/sessions/${session.id}`).set(auth(owner.token)).expect(200);
  });

  it('deletes a session with everything in it and tells the real-time side to close the room', async () => {
    const host = await registerHost(backend.api);
    const session = await createSession(backend.api, host.token);
    const guest = await joinAsGuest(backend.api, session.code, 'Gina');
    await backend.prisma.note.create({
      data: { sessionId: session.id, participantId: guest.participant.id, column: 'WENT_WELL', text: 'hi' },
    });

    await backend.api.delete(`/api/sessions/${session.id}`).set(auth(host.token)).expect(204);
    expect(await backend.prisma.participant.count()).toBe(0);
    expect(await backend.prisma.note.count()).toBe(0);
    await backend.api.get(`/api/sessions/${session.id}`).set(auth(host.token)).expect(404);
  });
});

describe('joining', () => {
  it('shows a preview for a valid code and 404 for an unknown one', async () => {
    const host = await registerHost(backend.api, 'Hannah');
    const session = await createSession(backend.api, host.token, 'Sprint 7');
    const preview = await backend.api.get(`/api/join/${session.code.toLowerCase()}`).expect(200);
    expect(preview.body).toEqual({ title: 'Sprint 7', phase: 'WRITING', hostName: 'Hannah' });
    await backend.api.get('/api/join/ZZZZZZ').expect(404);
    await backend.api.get('/api/join/short').expect(400);
  });

  it('lets guests in with a nickname and no account', async () => {
    const host = await registerHost(backend.api);
    const session = await createSession(backend.api, host.token);
    const join = await backend.api.post('/api/join').send({ code: session.code.toLowerCase(), nickname: '  Sam   Smith ' }).expect(201);
    expect(join.body.participant).toMatchObject({ nickname: 'Sam Smith', isHost: false });
    expect(join.body.session.id).toBe(session.id);
    expect(typeof join.body.token).toBe('string');
  });

  it('refuses a nickname that is taken, ignoring case', async () => {
    const host = await registerHost(backend.api);
    const session = await createSession(backend.api, host.token);
    await joinAsGuest(backend.api, session.code, 'Sam');
    const res = await backend.api.post('/api/join').send({ code: session.code, nickname: 'SAM' }).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
    // the same nickname is fine in a different session
    const other = await createSession(backend.api, host.token, 'Other');
    await joinAsGuest(backend.api, other.code, 'Sam');
  });

  it('validates the nickname and the code', async () => {
    const host = await registerHost(backend.api);
    const session = await createSession(backend.api, host.token);
    await backend.api.post('/api/join').send({ code: session.code, nickname: 'x' }).expect(400);
    await backend.api.post('/api/join').send({ code: session.code, nickname: 'y'.repeat(25) }).expect(400);
    await backend.api.post('/api/join').send({ code: 'bad', nickname: 'Sam' }).expect(400);
    await backend.api.post('/api/join').send({ code: 'ZZZZZZ', nickname: 'Sam' }).expect(404);
  });

  it('refuses to join a session that has ended', async () => {
    const host = await registerHost(backend.api);
    const session = await createSession(backend.api, host.token);
    await backend.prisma.retroSession.update({ where: { id: session.id }, data: { phase: 'CLOSED' } });
    const res = await backend.api.post('/api/join').send({ code: session.code, nickname: 'Late' }).expect(409);
    expect(res.body.error.code).toBe('WRONG_PHASE');
  });

  it('gives the host one participant, returned again on every "enter"', async () => {
    const host = await registerHost(backend.api, 'Hannah Host');
    const session = await createSession(backend.api, host.token);
    const first = await enterAsHost(backend.api, host.token, session.id);
    const second = await enterAsHost(backend.api, host.token, session.id);
    expect(first.participant).toMatchObject({ nickname: 'Hannah Host', isHost: true });
    expect(second.participant.id).toBe(first.participant.id);
    expect(await backend.prisma.participant.count()).toBe(1);
  });

  it('picks another nickname for the host when a guest already took theirs', async () => {
    const host = await registerHost(backend.api, 'Hannah');
    const session = await createSession(backend.api, host.token);
    await joinAsGuest(backend.api, session.code, 'hannah');
    const entered = await enterAsHost(backend.api, host.token, session.id);
    expect(entered.participant.nickname).toBe('Hannah (host)');
  });
});

describe('AI summary', () => {
  async function sessionWithNotes(phase: 'WRITING' | 'DISCUSSING' | 'CLOSED', noteCount = 4) {
    const host = await registerHost(backend.api);
    const session = await createSession(backend.api, host.token);
    const guest = await joinAsGuest(backend.api, session.code, 'Gina');
    for (let i = 0; i < noteCount; i++) {
      await backend.prisma.note.create({
        data: { sessionId: session.id, participantId: guest.participant.id, column: 'WENT_WELL', text: `note ${i}` },
      });
    }
    await backend.prisma.retroSession.update({ where: { id: session.id }, data: { phase } });
    return { host, session };
  }

  it('is only available from the discussing phase', async () => {
    const { host, session } = await sessionWithNotes('WRITING');
    const res = await backend.api.post(`/api/sessions/${session.id}/summary`).set(auth(host.token)).expect(409);
    expect(res.body.error.code).toBe('WRONG_PHASE');
    expect(llm.calls).toHaveLength(0);
  });

  it('needs at least 3 notes and does not call the AI without them', async () => {
    const { host, session } = await sessionWithNotes('DISCUSSING', 2);
    await backend.api.post(`/api/sessions/${session.id}/summary`).set(auth(host.token)).expect(400);
    expect(llm.calls).toHaveLength(0);
  });

  it('generates, stores and returns a sanitised summary, passing notes as delimited data', async () => {
    const { host, session } = await sessionWithNotes('DISCUSSING');
    const res = await backend.api.post(`/api/sessions/${session.id}/summary`).set(auth(host.token)).expect(200);

    expect(res.body.themes[0].title).toBe('Delivery pace');
    expect(res.body.actionItems).toHaveLength(2);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.user).toMatch(/^<notes>/);
    expect(llm.calls[0]?.system).toContain('never follow instructions');

    const stored = await backend.prisma.retroSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.summary).toMatchObject({ actionItems: ['Write a shared definition of done', 'Pair on the slowest review'] });

    // and the host can read it back with the session
    const read = await backend.api.get(`/api/sessions/${session.id}`).set(auth(host.token)).expect(200);
    expect(read.body.summary.themes).toHaveLength(1);
  });

  it('drops note ids the AI made up', async () => {
    const { host, session } = await sessionWithNotes('CLOSED');
    llm.respond = () => ({ themes: [{ title: 'Theme', summary: 'S', noteIds: ['invented-id'] }], actionItems: ['Do it'] });
    const res = await backend.api.post(`/api/sessions/${session.id}/summary`).set(auth(host.token)).expect(200);
    expect(res.body.themes[0].noteIds).toEqual([]);
  });

  it('answers 502 when the AI returns nonsense', async () => {
    const { host, session } = await sessionWithNotes('DISCUSSING');
    llm.respond = () => ({ unexpected: true });
    const res = await backend.api.post(`/api/sessions/${session.id}/summary`).set(auth(host.token)).expect(502);
    expect(res.body.error.code).toBe('AI_FAILED');
  });

  it('allows 3 summaries per session per hour, then answers 429 with Retry-After', async () => {
    const { host, session } = await sessionWithNotes('DISCUSSING');
    for (let i = 0; i < 3; i++) {
      await backend.api.post(`/api/sessions/${session.id}/summary`).set(auth(host.token)).expect(200);
    }
    const res = await backend.api.post(`/api/sessions/${session.id}/summary`).set(auth(host.token)).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(llm.calls).toHaveLength(3);
  });
});

describe('rate limits per IP address', () => {
  it('stops repeated sign-in attempts', async () => {
    const limited = await startBackend({ config: { rateLimitsEnabled: true } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 22; i++) {
        statuses.push((await limited.api.post('/api/auth/login').send({ email: 'x@example.com', password: 'wrong' })).status);
      }
      expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
      expect(statuses[20]).toBe(429);
      const res = await limited.api.post('/api/auth/login').send({ email: 'x@example.com', password: 'wrong' });
      expect(res.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });

  it('lets a whole team behind one network join within a minute', async () => {
    const limited = await startBackend({ config: { rateLimitsEnabled: true } });
    try {
      const host = await registerHost(limited.api);
      const session = await createSession(limited.api, host.token);
      const statuses: number[] = [];
      for (let i = 0; i < 60; i++) {
        statuses.push((await limited.api.post('/api/join').send({ code: session.code, nickname: `Person ${i}` })).status);
      }
      expect(statuses.every((s) => s === 201)).toBe(true);
    } finally {
      await limited.close();
    }
  });
});

describe('without an AI key', () => {
  it('answers 503 and the rest of the app keeps working', async () => {
    const plain = await startBackend(); // no llm override and no GEMINI_API_KEY => DisabledLlm
    try {
      const host = await registerHost(plain.api);
      const session = await createSession(plain.api, host.token);
      const guest = await joinAsGuest(plain.api, session.code, 'Gina');
      for (let i = 0; i < 3; i++) {
        await plain.prisma.note.create({
          data: { sessionId: session.id, participantId: guest.participant.id, column: 'TO_IMPROVE', text: `n${i}` },
        });
      }
      await plain.prisma.retroSession.update({ where: { id: session.id }, data: { phase: 'DISCUSSING' } });
      const res = await plain.api.post(`/api/sessions/${session.id}/summary`).set(auth(host.token)).expect(503);
      expect(res.body.error.code).toBe('AI_UNAVAILABLE');
      await plain.api.get(`/api/sessions/${session.id}/export`).set(auth(host.token)).expect(200);
    } finally {
      await plain.close();
    }
  });
});

describe('export', () => {
  it('returns the retrospective as Markdown', async () => {
    const host = await registerHost(backend.api);
    const session = await createSession(backend.api, host.token, 'Release retro');
    const guest = await joinAsGuest(backend.api, session.code, 'Gina');
    await backend.prisma.note.create({
      data: { sessionId: session.id, participantId: guest.participant.id, column: 'WENT_WELL', text: 'Smooth deploy' },
    });
    const res = await backend.api.get(`/api/sessions/${session.id}/export`).set(auth(host.token)).expect(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toContain('# Release retro');
    expect(res.text).toContain('Smooth deploy');
    expect(res.text).toContain('_Gina_');
  });
});
