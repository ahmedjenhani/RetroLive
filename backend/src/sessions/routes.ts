import { Router } from 'express';
import { LIMITS } from '@retrolive/shared';
import { summarize, MIN_NOTES_FOR_SUMMARY } from '../ai/summary';
import type { LlmClient } from '../ai/llm';
import { hostId, requireHost } from '../auth/middleware';
import type { TokenService } from '../auth/tokens';
import type { RealtimeHub } from '../realtime/hub';
import type { RetroService } from '../retro/service';
import { toSummary } from '../retro/mappers';
import { errors } from '../util/errors';
import { SlidingWindowLimiter } from '../util/rateLimiter';
import { parse, schemas } from '../util/validate';
import { buildMarkdown } from './export';
import type { SessionService } from './service';
import type { PrismaClient } from '@prisma/client';

interface Deps {
  prisma: PrismaClient;
  tokens: TokenService;
  sessions: SessionService;
  retro: RetroService;
  llm: LlmClient;
  hub: RealtimeHub;
}

/** Host-only routes under /api/sessions. */
export function sessionRoutes({ prisma, tokens, sessions, retro, llm, hub }: Deps): Router {
  const router = Router();
  const summaryLimiter = new SlidingWindowLimiter(LIMITS.SUMMARIES_PER_HOUR, 60 * 60 * 1000);
  router.use(requireHost(tokens));

  router.post('/', async (req, res) => {
    const { title } = parse(schemas.createSession, req.body);
    res.status(201).json(await sessions.create(hostId(res), title));
  });

  router.get('/', async (_req, res) => {
    res.json(await sessions.list(hostId(res)));
  });

  router.get('/:id', async (req, res) => {
    const owned = await sessions.getOwned(hostId(res), req.params['id'] as string);
    const notes = await retro.listNotes(owned.id);
    res.json({
      id: owned.id,
      title: owned.title,
      code: owned.code,
      phase: owned.phase,
      createdAt: owned.createdAt.toISOString(),
      notes,
      summary: toSummary(owned.summary),
    });
  });

  router.delete('/:id', async (req, res) => {
    const id = req.params['id'] as string;
    await sessions.delete(hostId(res), id);
    hub.closeRoom(id);
    res.status(204).end();
  });

  router.post('/:id/enter', async (req, res) => {
    res.json(await sessions.enterAsHost(hostId(res), req.params['id'] as string));
  });

  router.post('/:id/summary', async (req, res) => {
    const owned = await sessions.getOwned(hostId(res), req.params['id'] as string);
    if (owned.phase !== 'DISCUSSING' && owned.phase !== 'CLOSED') {
      throw errors.wrongPhase('The summary is available once the session reaches the discussing phase');
    }
    const notes = await retro.listNotes(owned.id);
    if (notes.length < MIN_NOTES_FOR_SUMMARY) {
      throw errors.validation(`Add at least ${MIN_NOTES_FOR_SUMMARY} notes before asking for a summary`);
    }
    const rate = summaryLimiter.hit(owned.id);
    if (!rate.allowed) {
      throw errors.rateLimited(
        rate.retryAfterSeconds,
        `You can generate ${LIMITS.SUMMARIES_PER_HOUR} summaries per hour for one session`,
      );
    }

    const summary = await summarize(llm, notes);
    await prisma.retroSession.update({ where: { id: owned.id }, data: { summary: JSON.parse(JSON.stringify(summary)) } });
    hub.summaryReady(owned.id, summary);
    res.json(summary);
  });

  router.get('/:id/export', async (req, res) => {
    const owned = await sessions.getOwned(hostId(res), req.params['id'] as string);
    const notes = await retro.listNotes(owned.id);
    const markdown = buildMarkdown({
      title: owned.title,
      createdAt: owned.createdAt,
      notes,
      summary: toSummary(owned.summary),
    });
    res.type('text/markdown; charset=utf-8').send(markdown);
  });

  return router;
}

/** Public routes under /api/join: anyone with a code can look up the session and join it. */
export function joinRoutes(sessions: SessionService): Router {
  const router = Router();

  router.get('/:code', async (req, res) => {
    const { code } = parse(schemas.join.pick({ code: true }), { code: req.params['code'] });
    res.json(await sessions.preview(code));
  });

  router.post('/', async (req, res) => {
    const { code, nickname } = parse(schemas.join, req.body);
    res.status(201).json(await sessions.joinAsGuest(code, nickname));
  });

  return router;
}
