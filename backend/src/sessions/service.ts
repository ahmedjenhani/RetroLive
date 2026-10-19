import { Prisma, type PrismaClient } from '@prisma/client';
import {
  LIMITS,
  type JoinPreview,
  type JoinResponse,
  type SessionInfo,
  type SessionListItem,
} from '@retrolive/shared';
import type { TokenService } from '../auth/tokens';
import { toPhase, toSessionInfo } from '../retro/mappers';
import { errors } from '../util/errors';
import { cleanLine } from '../util/validate';
import { generateJoinCode } from './code';

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const withHost = { host: { select: { name: true } } } as const;

/** Creating, listing and joining sessions. The rules *inside* a session live in RetroService. */
export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
  ) {}

  async create(hostId: string, title: string): Promise<SessionInfo> {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const session = await this.prisma.retroSession.create({
          data: { hostId, title, code: generateJoinCode() },
          include: withHost,
        });
        return toSessionInfo(session);
      } catch (err) {
        if (!isUniqueViolation(err)) {
          throw err;
        }
        // the random code was already taken: draw another one
      }
    }
    throw new Error('Could not generate a unique join code');
  }

  async list(hostId: string): Promise<SessionListItem[]> {
    const sessions = await this.prisma.retroSession.findMany({
      where: { hostId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { participants: true, notes: true } } },
    });
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      code: s.code,
      phase: toPhase(s.phase),
      createdAt: s.createdAt.toISOString(),
      participantCount: s._count.participants,
      noteCount: s._count.notes,
    }));
  }

  /** A session owned by this host. Someone else's session looks exactly like a missing one. */
  async getOwned(hostId: string, sessionId: string) {
    const session = await this.prisma.retroSession.findFirst({
      where: { id: sessionId, hostId },
      include: withHost,
    });
    if (!session) {
      throw errors.notFound('Session');
    }
    return session;
  }

  async delete(hostId: string, sessionId: string): Promise<void> {
    await this.getOwned(hostId, sessionId);
    await this.prisma.retroSession.delete({ where: { id: sessionId } });
  }

  /** The host takes part in their own session like everyone else: this finds or creates their participant. */
  async enterAsHost(hostId: string, sessionId: string): Promise<JoinResponse> {
    const session = await this.getOwned(hostId, sessionId);
    let participant = await this.prisma.participant.findFirst({ where: { sessionId, userId: hostId, isHost: true } });

    if (!participant) {
      const base = cleanLine(session.host.name).slice(0, LIMITS.NICKNAME_MAX);
      const candidates = [base, `${base.slice(0, LIMITS.NICKNAME_MAX - 7)} (host)`];
      for (const nickname of candidates) {
        try {
          participant = await this.prisma.participant.create({
            data: { sessionId, userId: hostId, isHost: true, nickname, nicknameKey: nickname.toLowerCase() },
          });
          break;
        } catch (err) {
          if (!isUniqueViolation(err)) {
            throw err;
          }
        }
      }
      if (!participant) {
        throw errors.conflict('Could not pick a nickname for the host in this session');
      }
    }
    return this.joinResponse(session, participant);
  }

  async preview(code: string): Promise<JoinPreview> {
    const session = await this.prisma.retroSession.findUnique({ where: { code }, include: withHost });
    if (!session) {
      throw errors.notFound('Session with that code');
    }
    return { title: session.title, phase: toPhase(session.phase), hostName: session.host.name };
  }

  async joinAsGuest(code: string, nickname: string): Promise<JoinResponse> {
    const session = await this.prisma.retroSession.findUnique({ where: { code }, include: withHost });
    if (!session) {
      throw errors.notFound('Session with that code');
    }
    if (session.phase === 'CLOSED') {
      throw errors.wrongPhase('This retrospective has already ended');
    }
    try {
      const participant = await this.prisma.participant.create({
        data: { sessionId: session.id, nickname, nicknameKey: nickname.toLowerCase() },
      });
      return this.joinResponse(session, participant);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw errors.conflict('That nickname is already taken in this session, pick another one');
      }
      throw err;
    }
  }

  private joinResponse(
    session: Parameters<typeof toSessionInfo>[0],
    participant: { id: string; nickname: string; isHost: boolean },
  ): JoinResponse {
    return {
      token: this.tokens.signParticipant(participant.id, session.id),
      session: toSessionInfo(session),
      participant: { id: participant.id, nickname: participant.nickname, isHost: participant.isHost },
    };
  }
}
