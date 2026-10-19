import type { Server } from 'socket.io';
import type { ClientToServerEvents, RetroSummary, ServerToClientEvents } from '@retrolive/shared';

export interface SocketData {
  participantId: string;
  sessionId: string;
  isHost: boolean;
  nickname: string;
}

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;
export const participantRoom = (participantId: string): string => `participant:${participantId}`;

/** What the REST side may ask of the real-time side (the socket server is attached after the app is built). */
export interface RealtimeHub {
  summaryReady(sessionId: string, summary: RetroSummary): void;
  /** Disconnects everyone in a session, used when the host deletes it. */
  closeRoom(sessionId: string): void;
}

export class SocketHub implements RealtimeHub {
  private io: TypedServer | undefined;

  attach(io: TypedServer): void {
    this.io = io;
  }

  summaryReady(sessionId: string, summary: RetroSummary): void {
    this.io?.to(sessionRoom(sessionId)).emit('summary:ready', summary);
  }

  closeRoom(sessionId: string): void {
    this.io?.in(sessionRoom(sessionId)).disconnectSockets(true);
  }
}

/** For tests of the REST API that do not need sockets. */
export class NullHub implements RealtimeHub {
  readonly summaries: { sessionId: string; summary: RetroSummary }[] = [];
  readonly closedRooms: string[] = [];

  summaryReady(sessionId: string, summary: RetroSummary): void {
    this.summaries.push({ sessionId, summary });
  }

  closeRoom(sessionId: string): void {
    this.closedRooms.push(sessionId);
  }
}
