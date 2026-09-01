import type { FastifyInstance } from 'fastify';
import { vocabStore } from '../db.js';
import { requireUser, resolveUser } from '../lib/resolveUser.js';
import { normalizeWord, type VocabRecord } from '../lib/vocab.js';
import { quizEnabled, translateWord } from '../services/providers.js';
import type { VocabEntry, VocabLookupResponse, VocabResponse } from '../types.js';

function toEntry(record: VocabRecord): VocabEntry {
  return {
    id: record.id,
    word: record.word,
    translation: record.translation,
    note: record.note,
    context: record.context,
    stationName: record.station_name,
    timesLookedUp: record.times_looked_up,
    createdAt: record.created_at,
    lastLookedUpAt: record.last_looked_up_at,
  };
}

interface LookupBody {
  word?: unknown;
  context?: unknown;
  stationName?: unknown;
}

export async function registerVocabRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/vocab', async (request, reply): Promise<VocabResponse | undefined> => {
    const user = requireUser(request, reply);
    if (!user) return;
    return { words: vocabStore.list(user.id).map(toEntry) };
  });

  // Lookup translates for everyone; it only PERSISTS to a vocab list when
  // signed in. Anonymous learners must not lose click-to-translate.
  app.post<{ Body: LookupBody }>('/api/vocab/lookup', async (request, reply) => {
    const user = resolveUser(request);

    const word = typeof request.body?.word === 'string' ? request.body.word.trim() : '';
    const context = typeof request.body?.context === 'string' ? request.body.context.slice(0, 600) : '';
    const stationName = typeof request.body?.stationName === 'string' ? request.body.stationName.slice(0, 120) : '';

    if (normalizeWord(word).length === 0 || word.length > 60) {
      return reply.status(400).send({ error: 'bad_request', message: 'A single word is required.' });
    }
    if (!quizEnabled()) {
      return reply.status(503).send({
        error: 'translation_unavailable',
        message:
          'Word lookup needs Ollama. Install it and run `ollama pull qwen2.5:7b-instruct`, then restart the server.',
      });
    }

    let translation;
    try {
      translation = await translateWord(word, context);
    } catch (error) {
      request.log.warn({ err: error, word }, 'word translation failed');
      return reply.status(502).send({
        error: 'translation_failed',
        message: 'The translation model did not respond. Try again.',
      });
    }

    if (!user) {
      const now = new Date().toISOString();
      const response: VocabLookupResponse = {
        saved: false,
        entry: {
          id: 0,
          word,
          translation: translation.translation,
          note: translation.note,
          context,
          stationName,
          timesLookedUp: 0,
          createdAt: now,
          lastLookedUpAt: now,
        },
      };
      return response;
    }

    const record = vocabStore.record({
      userId: user.id,
      word,
      translation: translation.translation,
      note: translation.note,
      context,
      stationName,
    });
    const response: VocabLookupResponse = { saved: true, entry: toEntry(record) };
    return response;
  });

  app.delete<{ Params: { id: string } }>('/api/vocab/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      return reply.status(400).send({ error: 'bad_request', message: 'A numeric id is required.' });
    }
    vocabStore.remove(user.id, id);
    return reply.status(204).send();
  });
}
