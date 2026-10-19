import jwt from 'jsonwebtoken';

const HOST_TTL = '7d';
const PARTICIPANT_TTL = '24h';

export interface ParticipantClaims {
  participantId: string;
  sessionId: string;
}

/**
 * Two kinds of tokens, told apart by the `typ` claim so one can never be used as the other:
 *  - host tokens identify a signed-in account (used for the REST API),
 *  - participant tokens identify one person in one session (used by the socket, for hosts and guests alike).
 */
export class TokenService {
  constructor(private readonly secret: string) {}

  signHost(userId: string): string {
    return jwt.sign({ typ: 'host' }, this.secret, { subject: userId, expiresIn: HOST_TTL, algorithm: 'HS256' });
  }

  signParticipant(participantId: string, sessionId: string): string {
    return jwt.sign({ typ: 'participant', sid: sessionId }, this.secret, {
      subject: participantId,
      expiresIn: PARTICIPANT_TTL,
      algorithm: 'HS256',
    });
  }

  verifyHost(token: string): { userId: string } | null {
    const payload = this.verify(token);
    if (!payload || payload['typ'] !== 'host' || typeof payload.sub !== 'string') {
      return null;
    }
    return { userId: payload.sub };
  }

  verifyParticipant(token: string): ParticipantClaims | null {
    const payload = this.verify(token);
    if (
      !payload ||
      payload['typ'] !== 'participant' ||
      typeof payload.sub !== 'string' ||
      typeof payload['sid'] !== 'string'
    ) {
      return null;
    }
    return { participantId: payload.sub, sessionId: payload['sid'] };
  }

  private verify(token: string): jwt.JwtPayload | null {
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
      return typeof payload === 'object' ? payload : null;
    } catch {
      return null;
    }
  }
}
