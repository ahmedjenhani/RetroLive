import { describe, expect, it } from 'vitest';
import { LIMITS, type NoteDto, type SessionState } from '@retrolive/shared';
import { boardReducer, initialBoard, type BoardState } from './reducer';

const note = (id: string, overrides: Partial<NoteDto> = {}): NoteDto => ({
  id,
  column: 'WENT_WELL',
  text: `note ${id}`,
  authorId: 'p1',
  authorNickname: 'Gina',
  voteCount: 0,
  createdAt: '2026-10-19T10:00:00.000Z',
  ...overrides,
});

const snapshot = (overrides: Partial<SessionState> = {}): SessionState => ({
  session: { id: 's1', title: 'Sprint', code: 'ABC234', phase: 'WRITING', timerEndsAt: null, hostName: 'Hannah' },
  me: { participantId: 'p1', nickname: 'Gina', isHost: false, myVotes: [], votesLeft: LIMITS.MAX_VOTES },
  notes: [],
  summary: null,
  presence: 1,
  serverNow: '2026-10-19T10:00:00.000Z',
  ...overrides,
});

const loaded = (state: SessionState = snapshot()): BoardState =>
  boardReducer(initialBoard, { type: 'state', state, receivedAt: Date.parse(state.serverNow) });

describe('boardReducer', () => {
  it('ignores messages that arrive before the first snapshot', () => {
    const result = boardReducer(initialBoard, { type: 'note:added', note: note('n1') });
    expect(result).toBe(initialBoard);
  });

  it('replaces everything with a new snapshot, as after a reconnect', () => {
    const before = boardReducer(loaded(), { type: 'note:added', note: note('stale') });
    const after = boardReducer(before, {
      type: 'state',
      state: snapshot({ notes: [note('fresh')] }),
      receivedAt: Date.parse('2026-10-19T10:00:00.000Z'),
    });
    expect(after.data?.notes.map((n) => n.id)).toEqual(['fresh']);
  });

  it('works out the difference between the server clock and ours', () => {
    const state = snapshot({ serverNow: '2026-10-19T10:00:05.000Z' });
    const board = boardReducer(initialBoard, { type: 'state', state, receivedAt: Date.parse('2026-10-19T10:00:00.000Z') });
    expect(board.clockOffsetMs).toBe(5000);
  });

  it('adds a note once even if the same note arrives twice (acknowledgement plus broadcast)', () => {
    let board = loaded();
    board = boardReducer(board, { type: 'note:added', note: note('n1') });
    board = boardReducer(board, { type: 'note:added', note: note('n1') });
    expect(board.data?.notes).toHaveLength(1);
  });

  it('updates a note in place and keeps the others', () => {
    let board = loaded(snapshot({ notes: [note('n1'), note('n2')] }));
    board = boardReducer(board, { type: 'note:updated', note: note('n1', { text: 'edited' }) });
    expect(board.data?.notes.map((n) => n.text)).toEqual(['edited', 'note n2']);
  });

  it('removes a deleted note and gives back the vote that was on it', () => {
    let board = loaded(
      snapshot({
        notes: [note('n1'), note('n2')],
        me: { participantId: 'p1', nickname: 'Gina', isHost: false, myVotes: ['n1', 'n2'], votesLeft: 1 },
      }),
    );
    board = boardReducer(board, { type: 'note:deleted', noteId: 'n1' });
    expect(board.data?.notes.map((n) => n.id)).toEqual(['n2']);
    expect(board.data?.me.myVotes).toEqual(['n2']);
    expect(board.data?.me.votesLeft).toBe(LIMITS.MAX_VOTES - 1);
  });

  it('updates vote totals for one note only', () => {
    let board = loaded(snapshot({ notes: [note('n1'), note('n2')] }));
    board = boardReducer(board, { type: 'votes:changed', noteId: 'n2', voteCount: 4 });
    expect(board.data?.notes.map((n) => n.voteCount)).toEqual([0, 4]);
  });

  it('keeps my own votes separate from the totals', () => {
    let board = loaded(snapshot({ notes: [note('n1')] }));
    board = boardReducer(board, { type: 'me:votes', myVotes: ['n1'], votesLeft: 2 });
    expect(board.data?.me).toMatchObject({ myVotes: ['n1'], votesLeft: 2 });
    expect(board.data?.notes[0]?.voteCount).toBe(0);
  });

  it('moves to the new phase and clears a running timer', () => {
    let board = loaded(snapshot({ session: { ...snapshot().session, timerEndsAt: '2026-10-19T10:05:00.000Z' } }));
    board = boardReducer(board, { type: 'phase:changed', phase: 'VOTING' });
    expect(board.data?.session.phase).toBe('VOTING');
    expect(board.data?.session.timerEndsAt).toBeNull();
  });

  it('starts and stops the timer, refreshing the clock offset', () => {
    let board = loaded();
    board = boardReducer(board, {
      type: 'timer:changed',
      timerEndsAt: '2026-10-19T10:03:00.000Z',
      serverNow: '2026-10-19T10:00:02.000Z',
      receivedAt: Date.parse('2026-10-19T10:00:00.000Z'),
    });
    expect(board.data?.session.timerEndsAt).toBe('2026-10-19T10:03:00.000Z');
    expect(board.clockOffsetMs).toBe(2000);

    board = boardReducer(board, { type: 'timer:changed', timerEndsAt: null, serverNow: '2026-10-19T10:00:03.000Z', receivedAt: 0 });
    expect(board.data?.session.timerEndsAt).toBeNull();
  });

  it('tracks who is online and stores the AI summary', () => {
    let board = loaded();
    board = boardReducer(board, { type: 'presence', count: 5 });
    board = boardReducer(board, {
      type: 'summary:ready',
      summary: { themes: [], actionItems: ['Do it'], generatedAt: '2026-10-19T10:00:00.000Z' },
    });
    expect(board.data?.presence).toBe(5);
    expect(board.data?.summary?.actionItems).toEqual(['Do it']);
  });

  it('never mutates the previous state', () => {
    const before = loaded(snapshot({ notes: [note('n1')] }));
    const frozen = JSON.stringify(before);
    boardReducer(before, { type: 'note:deleted', noteId: 'n1' });
    boardReducer(before, { type: 'votes:changed', noteId: 'n1', voteCount: 9 });
    expect(JSON.stringify(before)).toBe(frozen);
  });
});
