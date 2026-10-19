import { LIMITS, type NoteDto, type Phase, type RetroSummary, type SessionState } from '@retrolive/shared';

export interface BoardState {
  data: SessionState | null;
  /** serverTime - browserTime at the moment the server last told us its time. */
  clockOffsetMs: number;
}

export const initialBoard: BoardState = { data: null, clockOffsetMs: 0 };

export type BoardAction =
  | { type: 'state'; state: SessionState; receivedAt: number }
  | { type: 'note:added'; note: NoteDto }
  | { type: 'note:updated'; note: NoteDto }
  | { type: 'note:deleted'; noteId: string }
  | { type: 'votes:changed'; noteId: string; voteCount: number }
  | { type: 'me:votes'; myVotes: string[]; votesLeft: number }
  | { type: 'phase:changed'; phase: Phase }
  | { type: 'timer:changed'; timerEndsAt: string | null; serverNow: string; receivedAt: number }
  | { type: 'presence'; count: number }
  | { type: 'summary:ready'; summary: RetroSummary };

const upsert = (notes: NoteDto[], note: NoteDto): NoteDto[] =>
  notes.some((n) => n.id === note.id) ? notes.map((n) => (n.id === note.id ? note : n)) : [...notes, note];

/**
 * Applies one server message to the board. Pure, so it is easy to test.
 * Messages are idempotent on purpose: the person who adds a note gets it twice (the acknowledgement and the
 * broadcast), and after a reconnect a whole new snapshot replaces everything.
 */
export function boardReducer(board: BoardState, action: BoardAction): BoardState {
  if (action.type === 'state') {
    return { data: action.state, clockOffsetMs: Date.parse(action.state.serverNow) - action.receivedAt };
  }
  const data = board.data;
  if (!data) {
    return board; // messages before the first snapshot are meaningless
  }

  switch (action.type) {
    case 'note:added':
    case 'note:updated':
      return { ...board, data: { ...data, notes: upsert(data.notes, action.note) } };

    case 'note:deleted': {
      const myVotes = data.me.myVotes.filter((id) => id !== action.noteId);
      return {
        ...board,
        data: {
          ...data,
          notes: data.notes.filter((n) => n.id !== action.noteId),
          me: { ...data.me, myVotes, votesLeft: LIMITS.MAX_VOTES - myVotes.length },
        },
      };
    }

    case 'votes:changed':
      return {
        ...board,
        data: { ...data, notes: data.notes.map((n) => (n.id === action.noteId ? { ...n, voteCount: action.voteCount } : n)) },
      };

    case 'me:votes':
      return { ...board, data: { ...data, me: { ...data.me, myVotes: action.myVotes, votesLeft: action.votesLeft } } };

    case 'phase:changed':
      return { ...board, data: { ...data, session: { ...data.session, phase: action.phase, timerEndsAt: null } } };

    case 'timer:changed':
      return {
        data: { ...data, session: { ...data.session, timerEndsAt: action.timerEndsAt } },
        clockOffsetMs: Date.parse(action.serverNow) - action.receivedAt,
      };

    case 'presence':
      return { ...board, data: { ...data, presence: action.count } };

    case 'summary:ready':
      return { ...board, data: { ...data, summary: action.summary } };

    default:
      return board;
  }
}
