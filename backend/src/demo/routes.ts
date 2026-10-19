import { Router } from 'express';
import type { DemoService } from './service';

/** Public: anyone may ask for a demo (the per-IP limit is applied where this router is mounted). */
export function demoRoutes(demo: DemoService): Router {
  const router = Router();

  router.post('/', async (_req, res) => {
    res.status(201).json(await demo.create());
  });

  return router;
}
