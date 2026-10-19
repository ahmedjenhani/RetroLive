import { Prisma, type PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { AuthResponse, UserDto } from '@retrolive/shared';
import { errors } from '../util/errors';
import { parse, schemas } from '../util/validate';
import { hostId, requireHost } from './middleware';
import type { TokenService } from './tokens';

function toUserDto(user: { id: string; name: string; email: string }): UserDto {
  return { id: user.id, name: user.name, email: user.email };
}

export function authRoutes(prisma: PrismaClient, tokens: TokenService, bcryptRounds: number): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    const input = parse(schemas.register, req.body);
    const passwordHash = await bcrypt.hash(input.password, bcryptRounds);
    try {
      const user = await prisma.user.create({ data: { name: input.name, email: input.email, passwordHash } });
      const body: AuthResponse = { token: tokens.signHost(user.id), user: toUserDto(user) };
      res.status(201).json(body);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw errors.conflict('An account with this email already exists');
      }
      throw err;
    }
  });

  router.post('/login', async (req, res) => {
    const input = parse(schemas.login, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    // Same answer for "no such user" and "wrong password", so accounts cannot be discovered.
    const valid = user ? await bcrypt.compare(input.password, user.passwordHash) : false;
    if (!user || !valid) {
      throw errors.unauthenticated('Invalid email or password');
    }
    const body: AuthResponse = { token: tokens.signHost(user.id), user: toUserDto(user) };
    res.json(body);
  });

  router.get('/me', requireHost(tokens), async (_req, res) => {
    const user = await prisma.user.findUnique({ where: { id: hostId(res) } });
    if (!user) {
      throw errors.unauthenticated();
    }
    res.json(toUserDto(user));
  });

  return router;
}
