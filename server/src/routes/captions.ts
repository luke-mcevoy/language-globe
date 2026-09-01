import type { FastifyInstance } from 'fastify';
import { CaptureError } from '../services/capture.js';
import { captionSessions } from '../services/captionSessions.js';
import { captionsEnabled } from '../services/providers.js';
import { getStations } from '../services/stations.js';
import type { CaptionPollResponse, CaptionSessionCreatedResponse } from '../types.js';

function parseAfter(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseDelay(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 120) : 0;
}

export async function registerCaptionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { stationId?: string } }>('/api/captions/session', async (request, reply) => {
    if (!captionsEnabled()) {
      return reply.status(503).send({
        error: 'captions_disabled',
        message:
          'Captions need whisper.cpp. Set WHISPER_MODEL_PATH to a ggml model and install whisper-server (or whisper-cli).',
      });
    }

    const stationId = request.body?.stationId;
    if (typeof stationId !== 'string' || stationId.length === 0) {
      return reply.status(400).send({ error: 'bad_request', message: 'stationId is required.' });
    }

    const { stations } = await getStations();
    const station = stations.find((candidate) => candidate.id === stationId);
    if (!station) {
      return reply.status(404).send({ error: 'unknown_station', message: 'That station is no longer in the index.' });
    }

    try {
      const session = await captionSessions.create(station);
      const response: CaptionSessionCreatedResponse = {
        sessionId: session.id,
        chunkSeconds: session.chunkSeconds,
        audioContentType: session.contentType,
      };
      return response;
    } catch (error) {
      if (error instanceof CaptureError) {
        request.log.warn({ err: error, stationId }, 'caption session start failed');
        return reply.status(error.code === 'stream_failed' ? 429 : 502).send({ error: error.code, message: error.message });
      }
      request.log.error({ err: error, stationId }, 'caption session start failed');
      return reply.status(502).send({ error: 'stream_failed', message: 'Could not start captions for this station.' });
    }
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/api/captions/session/:id',
    async (request, reply) => {
      try {
        const chunks = await captionSessions.poll(request.params.id, parseAfter(request.query.after));
        if (!chunks) return reply.status(404).send({ error: 'unknown_session', message: 'Caption session expired.' });
        const session = captionSessions.get(request.params.id);
        const response: CaptionPollResponse = {
          chunks,
          audioBufferedMs: session?.audioBufferedMs() ?? null,
        };
        return response;
      } catch (error) {
        request.log.error({ err: error, sessionId: request.params.id }, 'caption polling failed');
        return reply.status(502).send({
          error: 'transcription_failed',
          message: 'Could not transcribe this caption chunk. Captions will retry shortly.',
        });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { delay?: string } }>(
    '/api/captions/session/:id/audio',
    async (request, reply) => {
      const session = captionSessions.get(request.params.id);
      if (!session) return reply.status(404).send({ error: 'unknown_session', message: 'Caption session expired.' });

      reply.raw.writeHead(200, {
        'Content-Type': session.contentType,
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });

      let closed = false;
      request.raw.on('close', () => {
        closed = true;
      });

      try {
        for await (const chunk of session.audioRelay(parseDelay(request.query.delay))) {
          if (closed) break;
          if (!reply.raw.write(chunk)) {
            await new Promise<void>((resolve) => reply.raw.once('drain', resolve));
          }
        }
      } catch (error) {
        request.log.warn({ err: error, sessionId: request.params.id }, 'caption audio relay failed');
      } finally {
        reply.raw.end();
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/captions/session/:id', async (request, reply) => {
    captionSessions.delete(request.params.id);
    return reply.status(204).send();
  });
}
