import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AckError, ClientToServerEvents, Column, Phase, RetroSummary, ServerToClientEvents } from '@retrolive/shared';
import { socketUrl } from '../lib/config';
import { boardReducer, initialBoard } from './reducer';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'unauthorized' | 'ended';
type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** What every action resolves to: success, or the error to show the user. It never rejects. */
export type ActionResult = { ok: true } | { ok: false; error: AckError };

const NOT_CONNECTED: ActionResult = {
  ok: false,
  error: { code: 'INTERNAL', message: 'Not connected right now. Reconnecting, please try again in a moment.' },
};

/**
 * One live connection to a session. The server is the source of truth: every change comes back as an event
 * and goes through the reducer, and a reconnect simply receives a fresh snapshot.
 */
export function useSession(token: string | null) {
  const [board, dispatch] = useReducer(boardReducer, initialBoard);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const socketRef = useRef<ClientSocket | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    setStatus('connecting');
    const socket: ClientSocket = io(socketUrl(), { auth: { token } });
    socketRef.current = socket;

    socket.on('state', (state) => {
      dispatch({ type: 'state', state, receivedAt: Date.now() });
      setStatus('online');
    });
    socket.on('note:added', (note) => dispatch({ type: 'note:added', note }));
    socket.on('note:updated', (note) => dispatch({ type: 'note:updated', note }));
    socket.on('note:deleted', ({ noteId }) => dispatch({ type: 'note:deleted', noteId }));
    socket.on('votes:changed', ({ noteId, voteCount }) => dispatch({ type: 'votes:changed', noteId, voteCount }));
    socket.on('me:votes', ({ myVotes, votesLeft }) => dispatch({ type: 'me:votes', myVotes, votesLeft }));
    socket.on('phase:changed', ({ phase }) => dispatch({ type: 'phase:changed', phase }));
    socket.on('timer:changed', ({ timerEndsAt, serverNow }) =>
      dispatch({ type: 'timer:changed', timerEndsAt, serverNow, receivedAt: Date.now() }),
    );
    socket.on('presence', ({ count }) => dispatch({ type: 'presence', count }));
    socket.on('summary:ready', (summary) => dispatch({ type: 'summary:ready', summary }));

    socket.on('disconnect', (reason) => {
      // "io server disconnect" means the server closed us on purpose (the host deleted the session)
      setStatus(reason === 'io server disconnect' ? 'ended' : 'reconnecting');
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'UNAUTHENTICATED') {
        setStatus('unauthorized'); // expired token or deleted session: retrying cannot help
        socket.close();
      } else {
        setStatus((s) => (s === 'online' ? 'reconnecting' : s));
      }
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [token]);

  const emit = useCallback(async <E extends keyof ClientToServerEvents>(
    event: E,
    payload: Parameters<ClientToServerEvents[E]>[0],
  ): Promise<ActionResult> => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      return NOT_CONNECTED;
    }
    try {
      // a deadline, so a lost acknowledgement turns into an error message instead of a stuck button
      const result = (await (socket as unknown as { timeout: (ms: number) => { emitWithAck: (e: string, p: unknown) => Promise<ActionResult> } })
        .timeout(8000)
        .emitWithAck(event, payload));
      return result;
    } catch {
      return { ok: false, error: { code: 'INTERNAL', message: 'The server did not answer in time. Please try again.' } };
    }
  }, []);

  const actions = useMemo(
    () => ({
      addNote: (column: Column, text: string) => emit('note:add', { column, text }),
      editNote: (noteId: string, text: string) => emit('note:edit', { noteId, text }),
      deleteNote: (noteId: string) => emit('note:delete', { noteId }),
      vote: (noteId: string) => emit('vote:add', { noteId }),
      unvote: (noteId: string) => emit('vote:remove', { noteId }),
      setPhase: (phase: Phase) => emit('host:set-phase', { phase }),
      startTimer: (seconds: number) => emit('host:start-timer', { seconds }),
      stopTimer: () => emit('host:stop-timer', {}),
    }),
    [emit],
  );

  /** Shows a summary we just received over HTTP; the live push of the same summary is then a harmless repeat. */
  const applySummary = useCallback((summary: RetroSummary) => dispatch({ type: 'summary:ready', summary }), []);

  return { state: board.data, clockOffsetMs: board.clockOffsetMs, status, actions, applySummary };
}
