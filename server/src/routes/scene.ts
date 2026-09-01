import type { FastifyInstance } from 'fastify';
import { countWords } from '../lib/text.js';
import { captionSessions } from '../services/captionSessions.js';
import { describeScene, quizEnabled } from '../services/providers.js';
import {
  fallbackScenePrompt,
  generateSceneImage,
  MIN_SCENE_TRANSCRIPT_WORDS,
  sceneServerAvailable,
} from '../services/scenes.js';
import { getStations } from '../services/stations.js';
import type { SceneResponse } from '../types.js';

export async function registerSceneRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { sessionId?: string } }>('/api/scene', async (request, reply) => {
    if (!(await sceneServerAvailable())) {
      return reply.status(503).send({
        error: 'scenes_disabled',
        message: 'The local image model is not running. Start it with scene-server/run.sh.',
      });
    }

    const sessionId = request.body?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return reply.status(400).send({ error: 'bad_request', message: 'sessionId is required.' });
    }
    const session = captionSessions.get(sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'unknown_session', message: 'Caption session expired.' });
    }

    // Prefer a scene grounded in what is actually being said; fall back to the
    // station's vibe (genre + place) for music stations or a cold start.
    const transcript = session.recentText();
    let prompt: string | null = null;
    let basedOn: SceneResponse['basedOn'] = 'station';
    if (countWords(transcript) >= MIN_SCENE_TRANSCRIPT_WORDS && quizEnabled()) {
      try {
        prompt = await describeScene(transcript);
        basedOn = 'transcript';
      } catch (error) {
        request.log.warn({ err: error, sessionId }, 'scene description failed, using station fallback');
      }
    }
    if (!prompt) {
      const { stations } = await getStations();
      const station = stations.find((candidate) => candidate.id === session.stationId);
      if (!station) {
        return reply.status(404).send({ error: 'unknown_station', message: 'That station is no longer in the index.' });
      }
      prompt = fallbackScenePrompt(station);
    }

    try {
      const { imageBase64, seconds } = await generateSceneImage(prompt);
      const response: SceneResponse = {
        image: `data:image/png;base64,${imageBase64}`,
        prompt,
        basedOn,
        seconds,
      };
      return response;
    } catch (error) {
      request.log.warn({ err: error, sessionId }, 'scene generation failed');
      return reply.status(502).send({
        error: 'scene_failed',
        message: 'The image model did not respond. The scene will retry shortly.',
      });
    }
  });
}
