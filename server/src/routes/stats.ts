import type { FastifyInstance } from 'fastify';
import { listResults } from '../db.js';
import { requireUser } from '../lib/resolveUser.js';
import { aggregateStats } from '../lib/stats.js';
import type { StatsResponse } from '../types.js';

export async function registerStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stats', async (request, reply): Promise<StatsResponse | undefined> => {
    const user = requireUser(request, reply);
    if (!user) return;
    return aggregateStats(listResults(user.id), new Date());
  });
}
