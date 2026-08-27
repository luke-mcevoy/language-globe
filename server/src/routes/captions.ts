import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { captionText } from '../lib/captions.js';
import { CaptureError, captureStream } from '../services/capture.js';
import { describeOpenAiError } from '../services/openai.js';
import { captionsEnabled, transcribeAudio } from '../services/providers.js';
import { getStations } from '../services/stations.js';
import type { CaptionsResponse } from '../types.js';

export async function registerCaptionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { stationId?: string } }>('/api/captions', async (request, reply) => {
    if (!captionsEnabled()) {
      return reply.status(503).send({
        error: 'captions_disabled',
        message: 'No transcription provider is available. Install local Whisper or set OPENAI_API_KEY in server/.env.',
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
      const capture = await captureStream(station.url, config.captionChunkSeconds);
      let transcript = '';
      try {
        transcript = await transcribeAudio(capture.filePath);
      } finally {
        await capture.cleanup();
      }

      const response: CaptionsResponse = {
        text: captionText(transcript),
        chunkSeconds: config.captionChunkSeconds,
        capturedAt: new Date().toISOString(),
      };
      return response;
    } catch (error) {
      if (error instanceof CaptureError) {
        request.log.warn({ err: error, stationId }, 'caption capture failed');
        return reply.status(502).send({ error: error.code, message: error.message });
      }
      request.log.error({ err: error, stationId }, 'caption transcription failed');
      const known = describeOpenAiError(error);
      if (known) return reply.status(502).send({ error: known.code, message: known.message });
      return reply.status(502).send({
        error: 'transcription_failed',
        message: 'Could not transcribe this caption chunk. Captions will retry shortly.',
      });
    }
  });
}
