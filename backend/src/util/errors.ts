import type { ErrorCode } from '@retrolive/shared';

/** An error the client is allowed to see. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  validation: (message = 'Invalid input', fields?: Record<string, string>) =>
    new AppError(400, 'VALIDATION', message, fields),
  unauthenticated: (message = 'Please sign in') => new AppError(401, 'UNAUTHENTICATED', message),
  forbidden: (message = 'You are not allowed to do that') => new AppError(403, 'FORBIDDEN', message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  wrongPhase: (message: string) => new AppError(409, 'WRONG_PHASE', message),
  limitReached: (message: string) => new AppError(409, 'LIMIT_REACHED', message),
  rateLimited: (retryAfterSeconds: number, message = 'Too many requests, please slow down') =>
    new AppError(429, 'RATE_LIMITED', message, undefined, retryAfterSeconds),
  aiUnavailable: (message = 'The AI summary is not available right now') => new AppError(503, 'AI_UNAVAILABLE', message),
  aiFailed: (message = 'The AI could not produce a usable summary. Please try again') =>
    new AppError(502, 'AI_FAILED', message),
};
