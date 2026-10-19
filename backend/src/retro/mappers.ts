import type { NoteColumn, Phase as DbPhase } from '@prisma/client';
import type { Column, NoteDto, Phase, RetroSummary, SessionInfo } from '@retrolive/shared';

// Prisma's enums and ours have the same string values; these helpers make that explicit and type-safe.
export const toPhase = (p: DbPhase): Phase => p;
export const toColumn = (c: NoteColumn): Column => c;

export function toSessionInfo(session: {
  id: string;
  title: string;
  code: string;
  phase: DbPhase;
  timerEndsAt: Date | null;
  host: { name: string };
}): SessionInfo {
  return {
    id: session.id,
    title: session.title,
    code: session.code,
    phase: toPhase(session.phase),
    timerEndsAt: session.timerEndsAt ? session.timerEndsAt.toISOString() : null,
    hostName: session.host.name,
  };
}

export function toNoteDto(
  note: {
    id: string;
    column: NoteColumn;
    text: string;
    participantId: string;
    createdAt: Date;
    participant: { nickname: string };
  },
  voteCount: number,
): NoteDto {
  return {
    id: note.id,
    column: toColumn(note.column),
    text: note.text,
    authorId: note.participantId,
    authorNickname: note.participant.nickname,
    voteCount,
    createdAt: note.createdAt.toISOString(),
  };
}

/** The summary is stored as JSON; anything that does not look like one is treated as "no summary". */
export function toSummary(value: unknown): RetroSummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const v = value as Partial<RetroSummary>;
  if (!Array.isArray(v.themes) || !Array.isArray(v.actionItems) || typeof v.generatedAt !== 'string') {
    return null;
  }
  return v as RetroSummary;
}
