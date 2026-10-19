import { z } from 'zod';
import { LIMITS } from '@retrolive/shared';
import { errors } from './errors';

/** Parses untrusted input and turns Zod's issues into our own validation error. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'body';
    fields[key] ??= issue.message;
  }
  throw errors.validation('Please check the highlighted fields', fields);
}

/** Strips control characters and collapses whitespace runs, but keeps single line breaks out. */
export function cleanLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export const schemas = {
  register: z.object({
    name: z.string().trim().min(1, 'Your name is required').max(60),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(255),
    password: z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters'),
  }),
  login: z.object({
    email: z.string().trim().toLowerCase().min(1, 'Email is required'),
    password: z.string().min(1, 'Password is required'),
  }),
  createSession: z.object({
    title: z
      .string()
      .transform(cleanLine)
      .pipe(z.string().min(1, 'Give the session a title').max(LIMITS.TITLE_MAX, `At most ${LIMITS.TITLE_MAX} characters`)),
  }),
  join: z.object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(new RegExp(`^[A-Z0-9]{${LIMITS.JOIN_CODE_LENGTH}}$`), 'The code has 6 letters or digits'),
    nickname: z
      .string()
      .transform(cleanLine)
      .pipe(
        z
          .string()
          .min(LIMITS.NICKNAME_MIN, `At least ${LIMITS.NICKNAME_MIN} characters`)
          .max(LIMITS.NICKNAME_MAX, `At most ${LIMITS.NICKNAME_MAX} characters`),
      ),
  }),
  noteAdd: z.object({
    column: z.enum(['WENT_WELL', 'TO_IMPROVE', 'ACTION_IDEAS']),
    text: z.string(),
  }),
  noteEdit: z.object({ noteId: z.string().min(1).max(64), text: z.string() }),
  noteRef: z.object({ noteId: z.string().min(1).max(64) }),
  setPhase: z.object({ phase: z.enum(['WRITING', 'VOTING', 'DISCUSSING', 'CLOSED']) }),
  startTimer: z.object({
    seconds: z
      .number()
      .int('Whole seconds only')
      .min(LIMITS.TIMER_MIN_SECONDS, `At least ${LIMITS.TIMER_MIN_SECONDS} seconds`)
      .max(LIMITS.TIMER_MAX_SECONDS, `At most ${LIMITS.TIMER_MAX_SECONDS} seconds`),
  }),
};

/** A note's text: single line breaks are allowed, everything else is trimmed and bounded. */
export function cleanNoteText(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length === 0) {
    throw errors.validation('A note cannot be empty', { text: 'Write something first' });
  }
  if (text.length > LIMITS.NOTE_MAX_LENGTH) {
    throw errors.validation(`A note can have at most ${LIMITS.NOTE_MAX_LENGTH} characters`, {
      text: `At most ${LIMITS.NOTE_MAX_LENGTH} characters`,
    });
  }
  return text;
}
