import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { LIMITS, type DemoResponse } from '@retrolive/shared';
import type { TokenService } from '../auth/tokens';
import type { RealtimeHub } from '../realtime/hub';
import { generateJoinCode } from '../sessions/code';
import { errors } from '../util/errors';

const HOUR_MS = 60 * 60 * 1000;

type Column = 'WENT_WELL' | 'TO_IMPROVE' | 'ACTION_IDEAS';

/** The sample retro every demo starts from. Votes are by index into NOTES. */
const TEAMMATES = ['Gina', 'Sam', 'Lee'] as const;
const NOTES: { by: 'Demo Host' | (typeof TEAMMATES)[number]; column: Column; text: string }[] = [
  { by: 'Gina', column: 'WENT_WELL', text: 'Pair programming helped us onboard the new hire quickly' },
  { by: 'Sam', column: 'WENT_WELL', text: 'The new CI pipeline catches bugs before review' },
  { by: 'Lee', column: 'WENT_WELL', text: 'Demo day went smoothly and the customer was happy' },
  { by: 'Demo Host', column: 'WENT_WELL', text: 'Daily standups stayed short and useful' },
  { by: 'Gina', column: 'TO_IMPROVE', text: 'Deployments take over 40 minutes and block everyone' },
  { by: 'Sam', column: 'TO_IMPROVE', text: 'Code reviews wait two days for a first response' },
  { by: 'Lee', column: 'TO_IMPROVE', text: 'Too many meetings in the middle of the week' },
  { by: 'Sam', column: 'TO_IMPROVE', text: 'Flaky tests make people ignore failures' },
  { by: 'Lee', column: 'ACTION_IDEAS', text: 'Set a 24 hour target for the first review comment' },
  { by: 'Gina', column: 'ACTION_IDEAS', text: 'Try a no-meeting Wednesday' },
  { by: 'Sam', column: 'ACTION_IDEAS', text: 'Cache dependencies to speed up the pipeline' },
];
/** Who voted for which note (indexes into NOTES). The visitor, the host, starts with all 3 votes unspent. */
const VOTES: Record<(typeof TEAMMATES)[number], number[]> = {
  Gina: [4, 5],
  Sam: [4, 0, 6],
  Lee: [4, 5, 9],
};

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * The "Try a demo" button: gives a visitor their own throwaway host account and a ready-made retro to play with.
 * Everything it creates is flagged, limited in number, and deleted again after a day.
 */
export class DemoService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
    private readonly hub: RealtimeHub,
    private readonly bcryptRounds: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(): Promise<DemoResponse> {
    await this.makeRoom();

    // Nobody knows this password, and demo accounts cannot sign in with a password at all.
    const passwordHash = await bcrypt.hash(randomUUID(), this.bcryptRounds);
    const startedAt = this.clock().getTime();

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const user = await tx.user.create({
              data: { email: `demo-${randomUUID()}@demo.invalid`, name: 'Demo Host', passwordHash, isDemo: true },
            });
            const session = await tx.retroSession.create({
              data: { hostId: user.id, title: 'Sprint 42 retrospective (demo)', code: generateJoinCode(), phase: 'VOTING' },
            });

            const host = await tx.participant.create({
              data: { sessionId: session.id, userId: user.id, isHost: true, nickname: 'Demo Host', nicknameKey: 'demo host' },
            });
            const people = new Map<string, string>([['Demo Host', host.id]]);
            for (const name of TEAMMATES) {
              const p = await tx.participant.create({
                data: { sessionId: session.id, nickname: name, nicknameKey: name.toLowerCase() },
              });
              people.set(name, p.id);
            }

            // spaced a minute apart so the notes keep their order
            const notes = await tx.note.createManyAndReturn({
              data: NOTES.map((n, i) => ({
                sessionId: session.id,
                participantId: people.get(n.by) as string,
                column: n.column,
                text: n.text,
                createdAt: new Date(startedAt - (NOTES.length - i) * 60_000),
              })),
              select: { id: true, createdAt: true },

            });
            const byOrder = [...notes].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            await tx.vote.createMany({
              data: TEAMMATES.flatMap((name) =>
                VOTES[name].map((noteIndex) => ({
                  noteId: (byOrder[noteIndex] as { id: string }).id,
                  participantId: people.get(name) as string,
                })),
              ),
            });

            return {
              token: this.tokens.signHost(user.id),
              user: { id: user.id, name: user.name, email: user.email, isDemo: true },
              sessionId: session.id,
            };
          },
          { timeout: 20_000 },
        );
      } catch (err) {
        if (!isUniqueViolation(err)) {
          throw err;
        }
        // the random join code was taken: try again with another one
      }
    }
    throw new Error('Could not create a demo session');
  }

  /** Deletes demo accounts older than the time limit, with their sessions, notes and votes. Returns how many. */
  async cleanup(now: Date = this.clock()): Promise<number> {
    const cutoff = new Date(now.getTime() - LIMITS.DEMO_TTL_HOURS * HOUR_MS);
    const expired = await this.prisma.user.findMany({
      where: { isDemo: true, createdAt: { lt: cutoff } },
      select: { id: true, sessions: { select: { id: true } } },
    });
    if (expired.length === 0) {
      return 0;
    }
    // anybody still looking at an expired demo board is disconnected, instead of being left with a dead page
    for (const user of expired) {
      for (const session of user.sessions) {
        this.hub.closeRoom(session.id);
      }
    }
    // sessions, participants, notes and votes follow through the database's cascading deletes
    const { count } = await this.prisma.user.deleteMany({ where: { id: { in: expired.map((u) => u.id) } } });
    return count;
  }

  /** Runs the cleanup now and then every hour. Returns a function that stops it. */
  startCleanup(intervalMs: number = HOUR_MS): () => void {
    const run = (): void => {
      this.cleanup().then(
        (count) => count > 0 && console.log(`[demo] deleted ${count} expired demo(s)`),
        (err: unknown) => console.error('[demo] cleanup failed', err),
      );
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref(); // never keeps the process alive on its own
    return () => clearInterval(timer);
  }

  /** Refuses to create more demos once the cap is reached (after first trying to free expired ones). */
  private async makeRoom(): Promise<void> {
    let active = await this.prisma.user.count({ where: { isDemo: true } });
    if (active >= LIMITS.DEMO_MAX_ACTIVE) {
      await this.cleanup();
      active = await this.prisma.user.count({ where: { isDemo: true } });
    }
    if (active >= LIMITS.DEMO_MAX_ACTIVE) {
      throw errors.rateLimited(300, 'The demo is very busy right now. Please try again in a few minutes');
    }
  }
}
