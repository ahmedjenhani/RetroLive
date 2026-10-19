import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { Ack, AckError, ClientToServerEvents, ServerToClientEvents } from '@retrolive/shared';
import type { TokenService } from '../auth/tokens';
import type { RetroService, Actor } from '../retro/service';
import { AppError, errors } from '../util/errors';
import { SlidingWindowLimiter } from '../util/rateLimiter';
import { parse, schemas } from '../util/validate';
import { participantRoom, sessionRoom, type SocketData, type SocketHub, type TypedServer } from './hub';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface Deps {
  httpServer: HttpServer;
  corsOrigins: string[];
  tokens: TokenService;
  retro: RetroService;
  hub: SocketHub;
  /** Turn off the per-connection event flood guard (used by tests that fire many events on purpose). */
  floodGuard?: boolean;
}

function toAckError(err: unknown): AckError {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message };
  }
  console.error('[socket] unexpected error', err);
  return { code: 'INTERNAL', message: 'Something went wrong' };
}

/**
 * Runs one client message: guards against floods, validates, executes, and always answers through the ack.
 * Nothing the client sends can crash the server or leave the client waiting.
 */
async function run<T extends object>(
  ack: unknown,
  allowed: () => boolean,
  work: () => Promise<T>,
): Promise<void> {
  const reply = (typeof ack === 'function' ? ack : () => undefined) as Ack<T>;
  try {
    if (!allowed()) {
      throw errors.rateLimited(5, 'Too many actions at once, please slow down');
    }
    reply({ ok: true, ...(await work()) });
  } catch (err) {
    reply({ ok: false, error: toAckError(err) });
  }
}

export function attachRealtime({ httpServer, corsOrigins, tokens, retro, hub, floodGuard = true }: Deps): TypedServer {
  const io: TypedServer = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
    { cors: { origin: corsOrigins, methods: ['GET', 'POST'] }, serveClient: false },
  );
  hub.attach(io);

  // sessionId -> (participantId -> open connections); the size is the number of people online
  const presence = new Map<string, Map<string, number>>();
  const online = (sessionId: string): number => presence.get(sessionId)?.size ?? 0;
  const announcePresence = (sessionId: string): void => {
    io.to(sessionRoom(sessionId)).emit('presence', { count: online(sessionId) });
  };

  const flood = new SlidingWindowLimiter(60, 10_000);

  // Every connection must present a participant token; who the user is comes from the database, not the client.
  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      const claims = typeof token === 'string' ? tokens.verifyParticipant(token) : null;
      const actor = claims ? await retro.loadActor(claims.participantId) : null;
      if (!claims || !actor || actor.sessionId !== claims.sessionId) {
        return next(new Error('UNAUTHENTICATED'));
      }
      socket.data = { ...actor };
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket: TypedSocket) => {
    const actor: Actor = { ...socket.data };
    const room = sessionRoom(actor.sessionId);
    const allowed = (): boolean => !floodGuard || flood.hit(socket.id).allowed;

    void socket.join([room, participantRoom(actor.participantId)]);
    const connections = presence.get(actor.sessionId) ?? new Map<string, number>();
    const alreadyOnline = connections.has(actor.participantId); // e.g. a second browser tab
    connections.set(actor.participantId, (connections.get(actor.participantId) ?? 0) + 1);
    presence.set(actor.sessionId, connections);

    retro
      .getState(actor, online(actor.sessionId))
      .then((state) => {
        socket.emit('state', state);
        if (!alreadyOnline) {
          announcePresence(actor.sessionId);
        }
      })
      .catch(() => socket.disconnect(true));

    // ---- notes
    socket.on('note:add', (payload, ack) =>
      run(ack, allowed, async () => {
        const note = await retro.addNote(actor, parse(schemas.noteAdd, payload));
        io.to(room).emit('note:added', note);
        return { note };
      }),
    );

    socket.on('note:edit', (payload, ack) =>
      run(ack, allowed, async () => {
        const note = await retro.editNote(actor, parse(schemas.noteEdit, payload));
        io.to(room).emit('note:updated', note);
        return { note };
      }),
    );

    socket.on('note:delete', (payload, ack) =>
      run(ack, allowed, async () => {
        const { noteId } = parse(schemas.noteRef, payload);
        const deleted = await retro.deleteNote(actor, noteId);
        io.to(room).emit('note:deleted', { noteId });
        // their vote on this note is gone, so each of them has a vote back
        for (const voterId of deleted.voterIds) {
          io.to(participantRoom(voterId)).emit('me:votes', await retro.votesLeft(voterId));
        }
        return {};
      }),
    );

    // ---- votes
    socket.on('vote:add', (payload, ack) =>
      run(ack, allowed, async () => {
        const { noteId } = parse(schemas.noteRef, payload);
        const result = await retro.addVote(actor, noteId);
        io.to(room).emit('votes:changed', { noteId, voteCount: result.voteCount });
        io.to(participantRoom(actor.participantId)).emit('me:votes', {
          myVotes: result.myVotes,
          votesLeft: result.votesLeft,
        });
        return { myVotes: result.myVotes, votesLeft: result.votesLeft };
      }),
    );

    socket.on('vote:remove', (payload, ack) =>
      run(ack, allowed, async () => {
        const { noteId } = parse(schemas.noteRef, payload);
        const result = await retro.removeVote(actor, noteId);
        io.to(room).emit('votes:changed', { noteId, voteCount: result.voteCount });
        io.to(participantRoom(actor.participantId)).emit('me:votes', {
          myVotes: result.myVotes,
          votesLeft: result.votesLeft,
        });
        return { myVotes: result.myVotes, votesLeft: result.votesLeft };
      }),
    );

    // ---- host controls
    socket.on('host:set-phase', (payload, ack) =>
      run(ack, allowed, async () => {
        const { phase } = parse(schemas.setPhase, payload);
        await retro.setPhase(actor, phase);
        io.to(room).emit('phase:changed', { phase });
        io.to(room).emit('timer:changed', { timerEndsAt: null, serverNow: new Date().toISOString() });
        return {};
      }),
    );

    socket.on('host:start-timer', (payload, ack) =>
      run(ack, allowed, async () => {
        const { seconds } = parse(schemas.startTimer, payload);
        const timerEndsAt = await retro.startTimer(actor, seconds);
        io.to(room).emit('timer:changed', { timerEndsAt, serverNow: new Date().toISOString() });
        return {};
      }),
    );

    socket.on('host:stop-timer', (_payload, ack) =>
      run(ack, allowed, async () => {
        await retro.stopTimer(actor);
        io.to(room).emit('timer:changed', { timerEndsAt: null, serverNow: new Date().toISOString() });
        return {};
      }),
    );

    socket.on('disconnect', () => {
      flood.forget(socket.id);
      const map = presence.get(actor.sessionId);
      if (!map) {
        return;
      }
      const left = (map.get(actor.participantId) ?? 1) - 1;
      if (left > 0) {
        map.set(actor.participantId, left); // still connected in another tab: nobody has left
        return;
      }
      map.delete(actor.participantId);
      if (map.size === 0) {
        presence.delete(actor.sessionId);
      }
      announcePresence(actor.sessionId);
    });
  });

  return io;
}
