import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { getStations } from '../services/stations.js';

export async function registerStationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { language?: string } }>('/api/stations', async (request, reply) => {
    const language = (request.query.language ?? config.targetLanguage).toLowerCase();
    try {
      return await getStations(language);
    } catch (error) {
      request.log.error({ err: error }, 'station fetch failed');
      return reply.status(502).send({
        error: 'stations_unavailable',
        message: 'Could not reach the Radio Browser directory. Check your connection and try again.',
      });
    }
  });
}
