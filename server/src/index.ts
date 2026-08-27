import Fastify from 'fastify';
import cors from '@fastify/cors';
import { captionsEnabled, config, quizEnabled } from './config.js';
import { registerCaptionRoutes } from './routes/captions.js';
import { registerQuizRoutes } from './routes/quiz.js';
import { registerStationRoutes } from './routes/stations.js';
import { registerStatsRoutes } from './routes/stats.js';
import { ffmpegAvailable, sweepTmpDir } from './services/capture.js';
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

app.get('/api/health', async (): Promise<HealthResponse> => ({
  ok: true,
  quizEnabled: quizEnabled(),
  captionsEnabled: captionsEnabled(),
  targetLanguage: config.targetLanguage,
  captureSeconds: config.captureSeconds,
  captionChunkSeconds: config.captionChunkSeconds,
  ffmpegAvailable: await ffmpegAvailable(),
}));

await registerStationRoutes(app);
await registerCaptionRoutes(app);
await registerQuizRoutes(app);
await registerStatsRoutes(app);

sweepTmpDir();

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { targetLanguage: config.targetLanguage, quizEnabled: quizEnabled() },
    quizEnabled() ? 'quizzes enabled' : 'quizzes disabled — add OPENAI_API_KEY to server/.env',
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
