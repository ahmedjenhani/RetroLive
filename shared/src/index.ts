/**
 * The contract between the API and the web app.
 * Both sides import this file, so a message can never be shaped differently on each end.
 */

// ---------------------------------------------------------------- vocabulary

export const COLUMNS = ['WENT_WELL', 'TO_IMPROVE', 'ACTION_IDEAS'] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABEL: Record<Column, string> = {
  WENT_WELL: 'Went well',
  TO_IMPROVE: 'To improve',
  ACTION_IDEAS: 'Action ideas',
};

export const PHASES = ['WRITING', 'VOTING', 'DISCUSSING', 'CLOSED'] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABEL: Record<Phase, string> = {
  WRITING: 'Writing',
  VOTING: 'Voting',
  DISCUSSING: 'Discussing',
  CLOSED: 'Closed',
};

export const PHASE_HINT: Record<Phase, string> = {
  WRITING: 'Add your notes. Everyone can see them as they appear.',
  VOTING: 'Spend your votes on the notes that matter most.',
  DISCUSSING: 'Talk through the top-voted notes, then close the session.',
  CLOSED: 'This retrospective is finished and read-only.',
};

/** The host may only move one step at a time, and may step back until the session is closed. */
export const PHASE_TRANSITIONS: Record<Phase, readonly Phase[]> = {
  WRITING: ['VOTING'],
  VOTING: ['WRITING', 'DISCUSSING'],
  DISCUSSING: ['VOTING', 'CLOSED'],
  CLOSED: [],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

export const LIMITS = {
  MAX_VOTES: 3,
  NOTE_MAX_LENGTH: 280,
  NOTES_PER_SESSION: 200,
  NOTES_PER_MINUTE: 20,
  NICKNAME_MIN: 2,
  NICKNAME_MAX: 24,
  TITLE_MAX: 80,
  TIMER_MIN_SECONDS: 30,
  TIMER_MAX_SECONDS: 1800,
  JOIN_CODE_LENGTH: 6,
  SUMMARIES_PER_HOUR: 3,
  /** "Try a demo" button: how many one visitor (IP address) may create per hour... */
  DEMOS_PER_HOUR_PER_IP: 5,
  /** ...how many demos may exist at once, so the database cannot be flooded... */
  DEMO_MAX_ACTIVE: 200,
  /** ...and how long a demo lives before it is deleted. */
  DEMO_TTL_HOURS: 24,
} as const;

// ---------------------------------------------------------------- data shapes

export interface NoteDto {
  id: string;
  column: Column;
  text: string;
  authorId: string;
  authorNickname: string;
  voteCount: number;
  createdAt: string;
}

export interface SummaryTheme {
  title: string;
  summary: string;
  noteIds: string[];
}

export interface RetroSummary {
  themes: SummaryTheme[];
  actionItems: string[];
  generatedAt: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  code: string;
  phase: Phase;
  /** ISO time when the running countdown ends, or null when no timer is running. */
  timerEndsAt: string | null;
  hostName: string;
}

export interface MeInfo {
  participantId: string;
  nickname: string;
  isHost: boolean;
  /** Ids of the notes this participant has voted for (only they can see this). */
  myVotes: string[];
  votesLeft: number;
}

/** Everything a client needs to draw the board. Sent on connect and after a reconnect. */
export interface SessionState {
  session: SessionInfo;
  me: MeInfo;
  notes: NoteDto[];
  summary: RetroSummary | null;
  /** Number of people currently connected. */
  presence: number;
  /** The server clock, so clients can show a countdown that matches the server. */
  serverNow: string;
}

// ---------------------------------------------------------------- REST

export interface UserDto {
  id: string;
  name: string;
  email: string;
  /** True for the throwaway account behind the "Try a demo" button. */
  isDemo: boolean;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}

/** What the "Try a demo" button returns: a signed-in demo host and the board to open. */
export interface DemoResponse extends AuthResponse {
  sessionId: string;
}

export interface SessionListItem {
  id: string;
  title: string;
  code: string;
  phase: Phase;
  createdAt: string;
  participantCount: number;
  noteCount: number;
}

export interface JoinPreview {
  title: string;
  phase: Phase;
  hostName: string;
}

/** Returned by "join" (guests) and "enter" (the host). The token is what the socket uses. */
export interface JoinResponse {
  token: string;
  session: SessionInfo;
  participant: { id: string; nickname: string; isHost: boolean };
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string> };
}

// ---------------------------------------------------------------- errors

export const ERROR_CODES = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'WRONG_PHASE',
  'LIMIT_REACHED',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'AI_FAILED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AckError {
  code: ErrorCode;
  message: string;
}

/** Every client-to-server message is answered with one of these. */
export type Ack<T extends object = object> = (result: ({ ok: true } & T) | { ok: false; error: AckError }) => void;

// ---------------------------------------------------------------- socket events

export interface ClientToServerEvents {
  'note:add': (payload: { column: Column; text: string }, ack: Ack<{ note: NoteDto }>) => void;
  'note:edit': (payload: { noteId: string; text: string }, ack: Ack<{ note: NoteDto }>) => void;
  'note:delete': (payload: { noteId: string }, ack: Ack) => void;
  'vote:add': (payload: { noteId: string }, ack: Ack<{ myVotes: string[]; votesLeft: number }>) => void;
  'vote:remove': (payload: { noteId: string }, ack: Ack<{ myVotes: string[]; votesLeft: number }>) => void;
  'host:set-phase': (payload: { phase: Phase }, ack: Ack) => void;
  'host:start-timer': (payload: { seconds: number }, ack: Ack) => void;
  'host:stop-timer': (payload: Record<string, never>, ack: Ack) => void;
}

export interface ServerToClientEvents {
  /** Full snapshot: sent right after connecting, including after an automatic reconnect. */
  state: (state: SessionState) => void;
  'note:added': (note: NoteDto) => void;
  'note:updated': (note: NoteDto) => void;
  'note:deleted': (payload: { noteId: string }) => void;
  /** Vote totals are broadcast, but who voted for what is private. */
  'votes:changed': (payload: { noteId: string; voteCount: number }) => void;
  /** Private to one participant (all of their open tabs). */
  'me:votes': (payload: { myVotes: string[]; votesLeft: number }) => void;
  'phase:changed': (payload: { phase: Phase }) => void;
  'timer:changed': (payload: { timerEndsAt: string | null; serverNow: string }) => void;
  presence: (payload: { count: number }) => void;
  'summary:ready': (summary: RetroSummary) => void;
}

/** What the socket handshake carries. */
export interface SocketAuth {
  token: string;
}
