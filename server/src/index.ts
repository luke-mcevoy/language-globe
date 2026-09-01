import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config, serverRoot } from './config.js';
import { registerCaptionRoutes } from './routes/captions.js';
import { registerFavoriteRoutes } from './routes/favorites.js';
import { registerQuizRoutes } from './routes/quiz.js';
import { registerStationRoutes } from './routes/stations.js';
import { registerSceneRoutes } from './routes/scene.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerVocabRoutes } from './routes/vocab.js';
import { sceneServerAvailable } from './services/scenes.js';
import { ffmpegAvailable, sweepTmpDir } from './services/capture.js';
import {
  captionsEnabled,
  getProviderStatus,
  initializeProviders,
  quizEnabled,
  shutdownProviders,
} from './services/providers.js';
import { getStations } from './services/stations.js';
import type { HealthResponse } from './types.js';

const app = Fastify({
  logger: { transport: undefined, level: process.env.LOG_LEVEL ?? 'info' },
  // Capturing a minute of radio, transcribing it and generating questions can
  // comfortably exceed Fastify's default request timeout.
  requestTimeout: 0,
  connectionTimeout: 0,
});

await app.register(cors, { origin: true });
await initializeProviders();

app.addHook('onClose', async () => {
  shutdownProviders();
});

app.get('/api/health', async (): Promise<HealthResponse> => ({
  ok: true,
  quizEnabled: quizEnabled(),
  captionsEnabled: captionsEnabled(),
  targetLanguage: config.targetLanguage,
  captureSeconds: config.captureSeconds,
  captionChunkSeconds: config.captionChunkSeconds,
  transcribeProvider: getProviderStatus().transcribeProvider,
  quizProvider: getProviderStatus().quizProvider,
  ffmpegAvailable: await ffmpegAvailable(),
  scenesEnabled: await sceneServerAvailable(),
}));

await registerStationRoutes(app);
await registerCaptionRoutes(app);
await registerQuizRoutes(app);
await registerStatsRoutes(app);
await registerFavoriteRoutes(app);
await registerVocabRoutes(app);
await registerSceneRoutes(app);

// Serve the built web app when it is present (the Docker image copies it to
// ../frontend/dist), so one container serves both the API and the UI. In dev
// the directory does not exist and Vite serves the frontend instead.
const staticDir = process.env.STATIC_DIR ?? path.join(serverRoot, '../frontend/dist');
if (fs.existsSync(path.join(staticDir, 'index.html'))) {
  await app.register(fastifyStatic, { root: staticDir });
  app.setNotFoundHandler(async (request, reply) => {
    // SPA fallback: unknown non-API GETs get index.html so client-side
    // routes survive a refresh; API 404s stay JSON.
    if (request.raw.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: `No route for ${request.method} ${request.url}` });
  });
}

sweepTmpDir();

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    {
      targetLanguage: config.targetLanguage,
      transcribeProvider: getProviderStatus().transcribeProvider,
      quizProvider: getProviderStatus().quizProvider,
    },
    'resolved model providers',
  );

  // Warm the station cache so the first globe load is instant. Failure here is
  // not fatal: the route retries and reports its own errors.
  void getStations().catch((error: unknown) => app.log.warn({ err: error }, 'station warmup failed'));
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
