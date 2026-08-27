import type { FastifyInstance } from 'fastify';
import { listResults } from '../db.js';
import { aggregateStats } from '../lib/stats.js';
import type { StatsResponse } from '../types.js';

export async function registerStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stats', async (): Promise<StatsResponse> => aggregateStats(listResults(), new Date()));
}
