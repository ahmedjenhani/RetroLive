import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, type NoteDto, type Phase } from '@retrolive/shared';
import {
  FakeLlm,
  connectClient,
  expectNoEvent,
  joinAsGuest,
  nextEvent,
  registerHost,
  createSession,
  resetDb,
  setupRoom,
  startBackend,
  type ClientSocket,
  type TestBackend,
} from './helpers';

let backend: TestBackend;
let llm: FakeLlm;
const rooms: Awaited<ReturnType<typeof setupRoom>>[] = [];

beforeAll(async () => {
  llm = new FakeLlm();
  backend = await startBackend({ llm });
});
afterAll(async () => {
  await backend.close();
});
beforeEach(async () => {
  await resetDb(backend.prisma);
});
afterEach(() => {
  rooms.splice(0).forEach((r) => r.closeAll());
});

async function room(guestNames?: string[]) {
  const r = await setupRoom(backend, guestNames);
  rooms.push(r);
  return r;
}

async function addNote(socket: ClientSocket, text: string, column: NoteDto['column'] = 'WENT_WELL'): Promise<NoteDto> {
  const res = await socket.emitWithAck('note:add', { column, text });
  if (!res.ok) {
    throw new Error(`note:add failed: ${res.error.code}`);
  }
  return res.note;
}

async function setPhase(socket: ClientSocket, phase: Phase): Promise<void> {
  const res = await socket.emitWithAck('host:set-phase', { phase });
  if (!res.ok) {
    throw new Error(`set-phase failed: ${res.error.code}`);
  }
}

describe('connecting', () => {
  it('sends the full state right away and tells everyone how many people are online', async () => {
    const r = await room(['Gina']);
    expect(r.hostState.me).toMatchObject({ isHost: true, nickname: 'Hannah Host', votesLeft: LIMITS.MAX_VOTES });
    expect(r.hostState.session).toMatchObject({ title: 'Sprint 42', phase: 'WRITING', timerEndsAt: null });
    expect(r.guests[0]?.state.me).toMatchObject({ isHost: false, nickname: 'Gina' });

    const joined = nextEvent(r.hostSocket, 'presence', (p) => p.count === 3);
    const sam = await connectClient(backend.url, (await joinAsGuest(backend.api, r.session.code, 'Sam')).token);
    await joined;

    const left = nextEvent(r.hostSocket, 'presence', (p) => p.count === 2);
    sam.socket.close();
    await left;
  });

  it('counts a person once even if they open two tabs', async () => {
    const r = await room(['Gina']); // host + Gina = 2 people
    const gina = r.guests[0]!;
    const secondTab = await connectClient(backend.url, gina.join.token); // still 2 people
    // when Sam arrives the count must be 3, not 4 (Gina's second tab is not a new person)
    const arrived = nextEvent(r.hostSocket, 'presence', (p) => p.count >= 3);
    const sam = await connectClient(backend.url, (await joinAsGuest(backend.api, r.session.code, 'Sam')).token);
    expect((await arrived).count).toBe(3);

    // closing one of Gina's two tabs does not make her leave
    secondTab.socket.close();
    await expectNoEvent(r.hostSocket, 'presence', 400);
    sam.socket.close();
  });

  it('rejects connections without a valid participant token', async () => {
    const r = await room([]);
    await expect(connectClient(backend.url, 'garbage')).rejects.toThrow('UNAUTHENTICATED');
    await expect(connectClient(backend.url, '')).rejects.toThrow('UNAUTHENTICATED');
    // a host (REST) token is not a participant token
    await expect(connectClient(backend.url, r.host.token)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('rejects the token of a session that was deleted', async () => {
    const r = await room(['Gina']);
    await backend.api.delete(`/api/sessions/${r.session.id}`).set('Authorization', `Bearer ${r.host.token}`).expect(204);
    await expect(connectClient(backend.url, r.guests[0]!.join.token)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('disconnects everyone when the host deletes the session', async () => {
    const r = await room(['Gina']);
    const gone = new Promise<void>((resolve) => r.guests[0]!.socket.once('disconnect', () => resolve()));
    await backend.api.delete(`/api/sessions/${r.session.id}`).set('Authorization', `Bearer ${r.host.token}`).expect(204);
    await gone;
  });

  it('restores everything after a reconnect, including your own votes', async () => {
    const r = await room(['Gina']);
    const gina = r.guests[0]!;
    const note = await addNote(gina.socket, 'Pairing works');
    await setPhase(r.hostSocket, 'VOTING');
    await gina.socket.emitWithAck('vote:add', { noteId: note.id });

    gina.socket.close();
    const again = await connectClient(backend.url, gina.join.token);
    expect(again.state.me.myVotes).toEqual([note.id]);
    expect(again.state.me.votesLeft).toBe(LIMITS.MAX_VOTES - 1);
    expect(again.state.notes[0]).toMatchObject({ id: note.id, voteCount: 1, authorNickname: 'Gina' });
    expect(again.state.session.phase).toBe('VOTING');
    again.socket.close();
  });
});

describe('notes', () => {
  it('shows a note to everyone as soon as it is added, with the author\'s nickname', async () => {
    const r = await room(['Gina', 'Sam']);
    const seenByHost = nextEvent(r.hostSocket, 'note:added');
    const seenBySam = nextEvent(r.guests[1]!.socket, 'note:added');

    const note = await addNote(r.guests[0]!.socket, '  Great   teamwork ', 'WENT_WELL');
    expect(note).toMatchObject({ text: 'Great teamwork', authorNickname: 'Gina', voteCount: 0, column: 'WENT_WELL' });
    expect(await seenByHost).toMatchObject({ id: note.id, authorNickname: 'Gina' });
    expect(await seenBySam).toMatchObject({ id: note.id });

    // and someone arriving later sees it in their first state
    const late = await connectClient(backend.url, (await joinAsGuest(backend.api, r.session.code, 'Late')).token);
    expect(late.state.notes.map((n) => n.id)).toEqual([note.id]);
    late.socket.close();
  });

  it('lets authors edit their own notes, and nobody else\'s', async () => {
    const r = await room(['Gina', 'Sam']);
    const note = await addNote(r.guests[0]!.socket, 'first draft');

    const updated = nextEvent(r.guests[1]!.socket, 'note:updated');
    const ok = await r.guests[0]!.socket.emitWithAck('note:edit', { noteId: note.id, text: 'second draft' });
    expect(ok).toMatchObject({ ok: true, note: { text: 'second draft' } });
    expect(await updated).toMatchObject({ text: 'second draft' });

    const denied = await r.guests[1]!.socket.emitWithAck('note:edit', { noteId: note.id, text: 'hijacked' });
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('lets authors delete their own notes while writing; others cannot', async () => {
    const r = await room(['Gina', 'Sam']);
    const note = await addNote(r.guests[0]!.socket, 'to be removed');
    const denied = await r.guests[1]!.socket.emitWithAck('note:delete', { noteId: note.id });
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const gone = nextEvent(r.hostSocket, 'note:deleted');
    expect(await r.guests[0]!.socket.emitWithAck('note:delete', { noteId: note.id })).toMatchObject({ ok: true });
    expect(await gone).toEqual({ noteId: note.id });
  });

  it('validates text, and a bad message never breaks the connection', async () => {
    const r = await room(['Gina']);
    const gina = r.guests[0]!.socket;
    const empty = await gina.emitWithAck('note:add', { column: 'WENT_WELL', text: '   ' });
    expect(empty).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const long = await gina.emitWithAck('note:add', { column: 'WENT_WELL', text: 'x'.repeat(LIMITS.NOTE_MAX_LENGTH + 1) });
    expect(long).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const garbage = await (gina as unknown as { emitWithAck: (e: string, p: unknown) => Promise<unknown> }).emitWithAck(
      'note:add',
      { column: 'NOT_A_COLUMN', text: 42 },
    );
    expect(garbage).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    // a message with no acknowledgement callback is ignored politely
    (gina as unknown as { emit: (e: string, p: unknown) => void }).emit('note:add', { column: 'WENT_WELL', text: 'no ack' });
    // still alive and working
    expect(await addNote(gina, 'still works')).toMatchObject({ text: 'still works' });
    expect(gina.connected).toBe(true);
  });

  it('stops at the maximum number of notes per session', async () => {
    const r = await room(['Gina']);
    const gina = r.guests[0]!;
    await backend.prisma.note.createMany({
      data: Array.from({ length: LIMITS.NOTES_PER_SESSION }, (_, i) => ({
        sessionId: r.session.id,
        participantId: gina.join.participant.id,
        column: 'WENT_WELL' as const,
        text: `bulk ${i}`,
      })),
    });
    const res = await gina.socket.emitWithAck('note:add', { column: 'WENT_WELL', text: 'one too many' });
    expect(res).toMatchObject({ ok: false, error: { code: 'LIMIT_REACHED' } });
  });
});

describe('phases', () => {
  it('lets only the host change the phase, one step at a time, and tells everyone', async () => {
    const r = await room(['Gina']);
    const guest = r.guests[0]!.socket;

    expect(await guest.emitWithAck('host:set-phase', { phase: 'VOTING' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await r.hostSocket.emitWithAck('host:set-phase', { phase: 'CLOSED' })).toMatchObject({
      ok: false,
      error: { code: 'WRONG_PHASE' },
    });

    const seen = nextEvent(guest, 'phase:changed');
    await setPhase(r.hostSocket, 'VOTING');
    expect(await seen).toEqual({ phase: 'VOTING' });
  });

  it('blocks writing once voting has started, and blocks voting while still writing', async () => {
    const r = await room(['Gina']);
    const gina = r.guests[0]!.socket;
    const note = await addNote(gina, 'a note');

    expect(await gina.emitWithAck('vote:add', { noteId: note.id })).toMatchObject({
      ok: false,
      error: { code: 'WRONG_PHASE' },
    });
    await setPhase(r.hostSocket, 'VOTING');
    expect(await gina.emitWithAck('note:add', { column: 'WENT_WELL', text: 'too late' })).toMatchObject({
      ok: false,
      error: { code: 'WRONG_PHASE' },
    });
    expect(await gina.emitWithAck('note:edit', { noteId: note.id, text: 'edited' })).toMatchObject({
      ok: false,
      error: { code: 'WRONG_PHASE' },
    });
    expect(await gina.emitWithAck('note:delete', { noteId: note.id })).toMatchObject({
      ok: false,
      error: { code: 'WRONG_PHASE' },
    });
  });

  it('lets the host moderate a note after writing, but not once the session is closed', async () => {
    const r = await room(['Gina']);
    const note = await addNote(r.guests[0]!.socket, 'off-topic');
    await setPhase(r.hostSocket, 'VOTING');
    expect(await r.hostSocket.emitWithAck('note:delete', { noteId: note.id })).toMatchObject({ ok: true });

    await setPhase(r.hostSocket, 'DISCUSSING');
    await setPhase(r.hostSocket, 'CLOSED');
    expect(await r.hostSocket.emitWithAck('host:set-phase', { phase: 'DISCUSSING' })).toMatchObject({
      ok: false,
      error: { code: 'WRONG_PHASE' },
    });
  });
});

describe('voting', () => {
  async function votingRoom(noteCount: number) {
    const r = await room(['Gina', 'Sam']);
    const [gina, sam] = r.guests as [(typeof r.guests)[number], (typeof r.guests)[number]];
    const notes: NoteDto[] = [];
    for (let i = 0; i < noteCount; i++) {
      notes.push(await addNote(sam.socket, `note ${i}`));
    }
    await setPhase(r.hostSocket, 'VOTING');
    return { r, gina, sam, notes };
  }

  it('gives everyone exactly 3 votes', async () => {
    const { gina, notes } = await votingRoom(5);
    for (let i = 0; i < LIMITS.MAX_VOTES; i++) {
      const res = await gina.socket.emitWithAck('vote:add', { noteId: notes[i]!.id });
      expect(res).toMatchObject({ ok: true, votesLeft: LIMITS.MAX_VOTES - i - 1 });
    }
    expect(await gina.socket.emitWithAck('vote:add', { noteId: notes[3]!.id })).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_REACHED' },
    });
  });

  it('refuses a second vote for the same note', async () => {
    const { gina, notes } = await votingRoom(2);
    await gina.socket.emitWithAck('vote:add', { noteId: notes[0]!.id });
    expect(await gina.socket.emitWithAck('vote:add', { noteId: notes[0]!.id })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
  });

  it('lets you take a vote back and spend it elsewhere; removing twice is harmless', async () => {
    const { gina, notes } = await votingRoom(5);
    for (let i = 0; i < 3; i++) {
      await gina.socket.emitWithAck('vote:add', { noteId: notes[i]!.id });
    }
    expect(await gina.socket.emitWithAck('vote:remove', { noteId: notes[0]!.id })).toMatchObject({ ok: true, votesLeft: 1 });
    expect(await gina.socket.emitWithAck('vote:remove', { noteId: notes[0]!.id })).toMatchObject({ ok: true, votesLeft: 1 });
    expect(await gina.socket.emitWithAck('vote:add', { noteId: notes[4]!.id })).toMatchObject({ ok: true, votesLeft: 0 });
  });

  it('never lets simultaneous votes exceed the limit', async () => {
    const { gina, notes } = await votingRoom(8);
    const results = await Promise.all(notes.map((n) => gina.socket.emitWithAck('vote:add', { noteId: n.id })));
    const accepted = results.filter((x) => x.ok).length;
    expect(accepted).toBe(LIMITS.MAX_VOTES);
    expect(results.filter((x) => !x.ok && x.error.code === 'LIMIT_REACHED')).toHaveLength(notes.length - LIMITS.MAX_VOTES);
    expect(await backend.prisma.vote.count({ where: { participantId: gina.join.participant.id } })).toBe(LIMITS.MAX_VOTES);
  });

  it('broadcasts totals to everyone but keeps who-voted-what private', async () => {
    const { r, gina, sam, notes } = await votingRoom(2);
    const totalSeenByHost = nextEvent(r.hostSocket, 'votes:changed');
    const private1 = nextEvent(gina.socket, 'me:votes');
    const noPrivateForSam = expectNoEvent(sam.socket, 'me:votes');

    await gina.socket.emitWithAck('vote:add', { noteId: notes[0]!.id });

    expect(await totalSeenByHost).toEqual({ noteId: notes[0]!.id, voteCount: 1 });
    expect(await private1).toEqual({ myVotes: [notes[0]!.id], votesLeft: 2 });
    await noPrivateForSam;
  });

  it('gives votes back when the host removes a note that had votes', async () => {
    const { r, gina, notes } = await votingRoom(2);
    await gina.socket.emitWithAck('vote:add', { noteId: notes[0]!.id });
    await gina.socket.emitWithAck('vote:add', { noteId: notes[1]!.id });

    const refund = nextEvent(gina.socket, 'me:votes', (p) => p.votesLeft === 2);
    await r.hostSocket.emitWithAck('note:delete', { noteId: notes[0]!.id });
    expect(await refund).toEqual({ myVotes: [notes[1]!.id], votesLeft: 2 });
  });

  it('only accepts votes for notes in your own session', async () => {
    const a = await room(['Gina']);
    const b = await room(['Zed']);
    const foreign = await addNote(b.guests[0]!.socket, 'secret of another session');
    await setPhase(a.hostSocket, 'VOTING');
    await setPhase(b.hostSocket, 'VOTING');

    expect(await a.guests[0]!.socket.emitWithAck('vote:add', { noteId: foreign.id })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await a.guests[0]!.socket.emitWithAck('note:edit', { noteId: foreign.id, text: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await a.hostSocket.emitWithAck('note:delete', { noteId: foreign.id })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('timer', () => {
  it('lets the host start and stop a countdown that everyone sees', async () => {
    const r = await room(['Gina']);
    const guest = r.guests[0]!.socket;

    const started = nextEvent(guest, 'timer:changed', (t) => t.timerEndsAt !== null);
    expect(await r.hostSocket.emitWithAck('host:start-timer', { seconds: 90 })).toMatchObject({ ok: true });
    const t = await started;
    const remainingMs = new Date(t.timerEndsAt as string).getTime() - new Date(t.serverNow).getTime();
    expect(remainingMs).toBeGreaterThan(85_000);
    expect(remainingMs).toBeLessThanOrEqual(90_000);

    // a newcomer gets the running timer in their first state
    const late = await connectClient(backend.url, (await joinAsGuest(backend.api, r.session.code, 'Late')).token);
    expect(late.state.session.timerEndsAt).toBe(t.timerEndsAt);
    late.socket.close();

    const stopped = nextEvent(guest, 'timer:changed', (x) => x.timerEndsAt === null);
    await r.hostSocket.emitWithAck('host:stop-timer', {});
    await stopped;
  });

  it('is host-only and limited to 30 seconds up to 30 minutes', async () => {
    const r = await room(['Gina']);
    expect(await r.guests[0]!.socket.emitWithAck('host:start-timer', { seconds: 60 })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await r.hostSocket.emitWithAck('host:start-timer', { seconds: 5 })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await r.hostSocket.emitWithAck('host:start-timer', { seconds: 100_000 })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('is cleared when the phase changes', async () => {
    const r = await room(['Gina']);
    await r.hostSocket.emitWithAck('host:start-timer', { seconds: 120 });
    const cleared = nextEvent(r.guests[0]!.socket, 'timer:changed', (t) => t.timerEndsAt === null);
    await setPhase(r.hostSocket, 'VOTING');
    await cleared;
    const row = await backend.prisma.retroSession.findUniqueOrThrow({ where: { id: r.session.id } });
    expect(row.timerEndsAt).toBeNull();
  });
});

describe('AI summary', () => {
  it('reaches everyone in the session the moment it is generated', async () => {
    const r = await room(['Gina', 'Sam']);
    for (const text of ['one', 'two', 'three']) {
      await addNote(r.guests[0]!.socket, text);
    }
    await setPhase(r.hostSocket, 'VOTING');
    await setPhase(r.hostSocket, 'DISCUSSING');

    const seenByGuest = nextEvent(r.guests[1]!.socket, 'summary:ready');
    await backend.api.post(`/api/sessions/${r.session.id}/summary`).set('Authorization', `Bearer ${r.host.token}`).expect(200);
    expect((await seenByGuest).actionItems.length).toBeGreaterThan(0);

    const late = await connectClient(backend.url, (await joinAsGuest(backend.api, r.session.code, 'Late')).token);
    expect(late.state.summary?.themes[0]?.title).toBe('Delivery pace');
    late.socket.close();
  });
});

describe('abuse protection', () => {
  it('limits how fast one person can add notes', async () => {
    const limited = await startBackend({ config: { rateLimitsEnabled: true } });
    try {
      const host = await registerHost(limited.api);
      const session = await createSession(limited.api, host.token);
      const guest = await joinAsGuest(limited.api, session.code, 'Gina');
      const { socket } = await connectClient(limited.url, guest.token);

      const results = [];
      for (let i = 0; i < LIMITS.NOTES_PER_MINUTE + 1; i++) {
        results.push(await socket.emitWithAck('note:add', { column: 'WENT_WELL', text: `n${i}` }));
      }
      expect(results.filter((x) => x.ok)).toHaveLength(LIMITS.NOTES_PER_MINUTE);
      expect(results[LIMITS.NOTES_PER_MINUTE]).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
      socket.close();
    } finally {
      await limited.close();
    }
  });

  it('shuts down message floods from a single connection', async () => {
    const guarded = await startBackend({ floodGuard: true });
    try {
      const host = await registerHost(guarded.api);
      const session = await createSession(guarded.api, host.token);
      const guest = await joinAsGuest(guarded.api, session.code, 'Gina');
      const { socket } = await connectClient(guarded.url, guest.token);

      const results = await Promise.all(
        Array.from({ length: 90 }, () => socket.emitWithAck('host:stop-timer', {})),
      );
      expect(results.some((x) => !x.ok && x.error.code === 'RATE_LIMITED')).toBe(true);
      socket.close();
    } finally {
      await guarded.close();
    }
  });
});
