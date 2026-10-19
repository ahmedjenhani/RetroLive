import { Prisma, type PrismaClient } from '@prisma/client';
import {
  LIMITS,
  canTransition,
  type Column,
  type NoteDto,
  type Phase,
  type SessionState,
} from '@retrolive/shared';
import { errors } from '../util/errors';
import type { SlidingWindowLimiter } from '../util/rateLimiter';
import { cleanNoteText } from '../util/validate';
import { toNoteDto, toPhase, toSessionInfo, toSummary } from './mappers';

/** Who is acting. Loaded from the database when a socket connects, never trusted from the client. */
export interface Actor {
  participantId: string;
  sessionId: string;
  isHost: boolean;
  nickname: string;
}

export interface VoteResult {
  voteCount: number;
  myVotes: string[];
  votesLeft: number;
}

export interface DeletedNote {
  noteId: string;
  /** People who had voted for the note, so their remaining votes can be refreshed. */
  voterIds: string[];
}

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** All the rules of a retrospective. It talks to the database and knows nothing about HTTP or sockets. */
export class RetroService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly noteLimiter: SlidingWindowLimiter | null = null,
  ) {}

  async loadActor(participantId: string): Promise<Actor | null> {
    const p = await this.prisma.participant.findUnique({ where: { id: participantId } });
    return p ? { participantId: p.id, sessionId: p.sessionId, isHost: p.isHost, nickname: p.nickname } : null;
  }

  async getState(actor: Actor, presence: number): Promise<SessionState> {
    const session = await this.prisma.retroSession.findUnique({
      where: { id: actor.sessionId },
      include: { host: { select: { name: true } } },
    });
    if (!session) {
      throw errors.notFound('Session');
    }
    const notes = await this.listNotes(actor.sessionId);
    const myVotes = await this.myVotes(actor.participantId);
    return {
      session: toSessionInfo(session),
      me: {
        participantId: actor.participantId,
        nickname: actor.nickname,
        isHost: actor.isHost,
        myVotes,
        votesLeft: LIMITS.MAX_VOTES - myVotes.length,
      },
      notes,
      summary: toSummary(session.summary),
      presence,
      serverNow: new Date().toISOString(),
    };
  }

  /** Notes of a session, oldest first, each with its vote count. */
  async listNotes(sessionId: string): Promise<NoteDto[]> {
    const notes = await this.prisma.note.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      include: { participant: { select: { nickname: true } }, _count: { select: { votes: true } } },
    });
    return notes.map((n) => toNoteDto(n, n._count.votes));
  }

  // ------------------------------------------------------------------ notes

  async addNote(actor: Actor, input: { column: Column; text: string }): Promise<NoteDto> {
    const session = await this.session(actor.sessionId);
    if (session.phase !== 'WRITING') {
      throw errors.wrongPhase('Notes can only be added while the session is in the writing phase');
    }
    const text = cleanNoteText(input.text);

    const rate = this.noteLimiter?.hit(actor.participantId);
    if (rate && !rate.allowed) {
      throw errors.rateLimited(rate.retryAfterSeconds, 'You are adding notes too fast, take a breath');
    }
    const existing = await this.prisma.note.count({ where: { sessionId: actor.sessionId } });
    if (existing >= LIMITS.NOTES_PER_SESSION) {
      throw errors.limitReached(`This session already has the maximum of ${LIMITS.NOTES_PER_SESSION} notes`);
    }

    const note = await this.prisma.note.create({
      data: { sessionId: actor.sessionId, participantId: actor.participantId, column: input.column, text },
      include: { participant: { select: { nickname: true } } },
    });
    return toNoteDto(note, 0);
  }

  async editNote(actor: Actor, input: { noteId: string; text: string }): Promise<NoteDto> {
    const note = await this.noteInSession(actor, input.noteId);
    if (note.participantId !== actor.participantId) {
      throw errors.forbidden('You can only edit your own notes');
    }
    const session = await this.session(actor.sessionId);
    if (session.phase !== 'WRITING') {
      throw errors.wrongPhase('Notes can only be edited while the session is in the writing phase');
    }
    const text = cleanNoteText(input.text);
    const updated = await this.prisma.note.update({
      where: { id: note.id },
      data: { text },
      include: { participant: { select: { nickname: true } }, _count: { select: { votes: true } } },
    });
    return toNoteDto(updated, updated._count.votes);
  }

  /** Authors can delete their own notes while writing; the host can remove any note until the session closes. */
  async deleteNote(actor: Actor, noteId: string): Promise<DeletedNote> {
    const note = await this.noteInSession(actor, noteId);
    const session = await this.session(actor.sessionId);
    const own = note.participantId === actor.participantId;

    if (session.phase === 'CLOSED') {
      throw errors.wrongPhase('This session is closed');
    }
    if (!own && !actor.isHost) {
      throw errors.forbidden('You can only delete your own notes');
    }
    if (own && !actor.isHost && session.phase !== 'WRITING') {
      throw errors.wrongPhase('You can only delete your notes while the session is in the writing phase');
    }

    const voters = await this.prisma.vote.findMany({ where: { noteId }, select: { participantId: true } });
    await this.prisma.note.delete({ where: { id: noteId } });
    return { noteId, voterIds: voters.map((v) => v.participantId) };
  }

  // ------------------------------------------------------------------ votes

  async addVote(actor: Actor, noteId: string): Promise<VoteResult> {
    const session = await this.session(actor.sessionId);
    if (session.phase !== 'VOTING') {
      throw errors.wrongPhase('Votes can only be cast while the session is in the voting phase');
    }
    await this.noteInSession(actor, noteId);

    await this.prisma.$transaction(async (tx) => {
      // Lock this participant's row so two simultaneous votes are checked one after the other.
      // Without it, both could read "2 votes used" and both be accepted, ending at 4.
      await tx.$queryRaw`SELECT id FROM "Participant" WHERE id = ${actor.participantId} FOR UPDATE`;
      const used = await tx.vote.count({ where: { participantId: actor.participantId } });
      if (used >= LIMITS.MAX_VOTES) {
        throw errors.limitReached(`You have used all ${LIMITS.MAX_VOTES} of your votes`);
      }
      try {
        await tx.vote.create({ data: { noteId, participantId: actor.participantId } });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw errors.conflict('You already voted for this note');
        }
        throw err;
      }
    });
    return this.voteResult(actor.participantId, noteId);
  }

  /** Removing a vote you do not have is not an error, so a double click is harmless. */
  async removeVote(actor: Actor, noteId: string): Promise<VoteResult> {
    const session = await this.session(actor.sessionId);
    if (session.phase !== 'VOTING') {
      throw errors.wrongPhase('Votes can only be changed while the session is in the voting phase');
    }
    await this.noteInSession(actor, noteId);
    await this.prisma.vote.deleteMany({ where: { noteId, participantId: actor.participantId } });
    return this.voteResult(actor.participantId, noteId);
  }

  async myVotes(participantId: string): Promise<string[]> {
    const votes = await this.prisma.vote.findMany({
      where: { participantId },
      orderBy: { createdAt: 'asc' },
      select: { noteId: true },
    });
    return votes.map((v) => v.noteId);
  }

  async votesLeft(participantId: string): Promise<{ myVotes: string[]; votesLeft: number }> {
    const myVotes = await this.myVotes(participantId);
    return { myVotes, votesLeft: LIMITS.MAX_VOTES - myVotes.length };
  }

  // ------------------------------------------------------------------ host controls

  async setPhase(actor: Actor, phase: Phase): Promise<Phase> {
    this.requireHost(actor);
    const session = await this.session(actor.sessionId);
    const from = toPhase(session.phase);
    if (!canTransition(from, phase)) {
      throw errors.wrongPhase(`The session cannot go from ${from} to ${phase}`);
    }
    // A running countdown belongs to the phase it was started in.
    await this.prisma.retroSession.update({ where: { id: session.id }, data: { phase, timerEndsAt: null } });
    return phase;
  }

  async startTimer(actor: Actor, seconds: number): Promise<string> {
    this.requireHost(actor);
    const session = await this.session(actor.sessionId);
    if (session.phase === 'CLOSED') {
      throw errors.wrongPhase('This session is closed');
    }
    const endsAt = new Date(Date.now() + seconds * 1000);
    await this.prisma.retroSession.update({ where: { id: session.id }, data: { timerEndsAt: endsAt } });
    return endsAt.toISOString();
  }

  async stopTimer(actor: Actor): Promise<void> {
    this.requireHost(actor);
    await this.prisma.retroSession.update({ where: { id: actor.sessionId }, data: { timerEndsAt: null } });
  }

  // ------------------------------------------------------------------ helpers

  private requireHost(actor: Actor): void {
    if (!actor.isHost) {
      throw errors.forbidden('Only the host can do that');
    }
  }

  private async session(sessionId: string) {
    const session = await this.prisma.retroSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw errors.notFound('Session');
    }
    return session;
  }

  /** A note that must belong to the actor's own session; otherwise it looks like it does not exist. */
  private async noteInSession(actor: Actor, noteId: string) {
    const note = await this.prisma.note.findFirst({ where: { id: noteId, sessionId: actor.sessionId } });
    if (!note) {
      throw errors.notFound('Note');
    }
    return note;
  }

  private async voteResult(participantId: string, noteId: string): Promise<VoteResult> {
    const [voteCount, mine] = await Promise.all([
      this.prisma.vote.count({ where: { noteId } }),
      this.votesLeft(participantId),
    ]);
    return { voteCount, ...mine };
  }
}
