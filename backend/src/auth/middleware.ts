import type { RequestHandler, Response } from 'express';
import { errors } from '../util/errors';
import type { TokenService } from './tokens';

/** Requires "Authorization: Bearer <host token>" and stores the user id for the route handler. */
export function requireHost(tokens: TokenService): RequestHandler {
  return (req, res, next) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const claims = token ? tokens.verifyHost(token) : null;
    if (!claims) {
      throw errors.unauthenticated();
    }
    res.locals['userId'] = claims.userId;
    next();
  };
}

export function hostId(res: Response): string {
  return res.locals['userId'] as string;
}
