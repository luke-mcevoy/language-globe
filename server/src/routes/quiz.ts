import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config, quizEnabled } from '../config.js';
import { getQuiz, insertQuiz, recordResult } from '../db.js';
import { gradeQuiz } from '../lib/grading.js';
import { countWords } from '../lib/text.js';
import { CaptureError, captureStream } from '../services/capture.js';
import { generateQuestions, transcribe } from '../services/openai.js';
import { getStations, suggestTalkStation } from '../services/stations.js';
import type { Difficulty, QuizQuestion, QuizStartResponse, QuizSubmitResponse } from '../types.js';

/**
 * Below this, a minute of audio is a song with a DJ tag rather than speech we
 * can build four comprehension questions from.
 */
export const MIN_SPEECH_WORDS = 40;

function parseDifficulty(value: unknown): Difficulty {
  return value === 'intermediate' ? 'intermediate' : 'beginner';
}

export async function registerQuizRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { stationId?: string; difficulty?: string } }>('/api/quiz/start', async (request, reply) => {
    if (!quizEnabled()) {
      return reply.status(503).send({
        error: 'quiz_disabled',
        message: 'Add OPENAI_API_KEY to server/.env to enable quizzes.',
      });
    }

    const stationId = request.body?.stationId;
    if (typeof stationId !== 'string' || stationId.length === 0) {
      return reply.status(400).send({ error: 'bad_request', message: 'stationId is required.' });
    }
    const difficulty = parseDifficulty(request.body?.difficulty);

    const { stations } = await getStations();
    const station = stations.find((candidate) => candidate.id === stationId);
    if (!station) {
      return reply.status(404).send({ error: 'unknown_station', message: 'That station is no longer in the index.' });
    }

    let transcript: string;
    try {
      const capture = await captureStream(station.url);
      try {
        transcript = await transcribe(capture.filePath);
      } finally {
        // Always remove the clip, including when transcription throws.
        await capture.cleanup();
      }
    } catch (error) {
      if (error instanceof CaptureError) {
        request.log.warn({ err: error, stationId }, 'capture failed');
        return reply.status(502).send({ error: error.code, message: error.message });
      }
      request.log.error({ err: error, stationId }, 'transcription failed');
      return reply.status(502).send({
        error: 'transcription_failed',
        message: 'Could not transcribe this clip. Try again, or try another station.',
      });
    }

    const wordCount = countWords(transcript);
    if (wordCount < MIN_SPEECH_WORDS) {
      const response: QuizStartResponse = {
        kind: 'not_enough_speech',
        transcript,
        wordCount,
        suggestion: suggestTalkStation(stations, station),
      };
      return response;
    }

    let questions: QuizQuestion[];
    try {
      questions = await generateQuestions(transcript, difficulty);
    } catch (error) {
      request.log.error({ err: error, stationId }, 'question generation failed');
      return reply.status(502).send({
        error: 'generation_failed',
        message: 'The quiz model could not turn that clip into questions. Try again.',
      });
    }

    const quizId = randomUUID();
    insertQuiz({
      id: quizId,
      stationId: station.id,
      stationName: station.name,
      country: station.country,
      countryCode: station.countryCode,
      difficulty,
      transcript,
      questions,
    });

    const response: QuizStartResponse = {
      kind: 'quiz',
      quizId,
      difficulty,
      questions: questions.map((question) => ({ question: question.question, options: question.options })),
      transcriptWords: wordCount,
      stationName: station.name,
    };
    return response;
  });

  app.post<{ Body: { quizId?: string; answers?: unknown } }>('/api/quiz/submit', async (request, reply) => {
    const quizId = request.body?.quizId;
    if (typeof quizId !== 'string' || quizId.length === 0) {
      return reply.status(400).send({ error: 'bad_request', message: 'quizId is required.' });
    }

    const stored = getQuiz(quizId);
    if (!stored) {
      return reply.status(404).send({ error: 'unknown_quiz', message: 'That quiz has expired or never existed.' });
    }

    let questions: QuizQuestion[];
    try {
      questions = JSON.parse(stored.questions_json) as QuizQuestion[];
    } catch {
      return reply.status(500).send({ error: 'corrupt_quiz', message: 'Stored quiz could not be read.' });
    }

    const graded = gradeQuiz(questions, request.body?.answers);

    recordResult({
      quizId,
      stationId: stored.station_id,
      stationName: stored.station_name,
      country: stored.country,
      countryCode: stored.country_code,
      difficulty: stored.difficulty,
      nQuestions: graded.total,
      nCorrect: graded.score,
      transcriptWords: countWords(stored.transcript),
    });

    const response: QuizSubmitResponse = {
      quizId,
      score: graded.score,
      total: graded.total,
      results: graded.results,
      transcript: stored.transcript,
    };
    return response;
  });

  app.get<{ Params: { quizId: string } }>('/api/quiz/:quizId/transcript', async (request, reply) => {
    const stored = getQuiz(request.params.quizId);
    if (!stored) return reply.status(404).send({ error: 'unknown_quiz', message: 'No such quiz.' });
    return { quizId: stored.id, transcript: stored.transcript, difficulty: stored.difficulty };
  });

  app.get('/api/quiz/config', async () => ({
    enabled: quizEnabled(),
    captureSeconds: config.captureSeconds,
    minSpeechWords: MIN_SPEECH_WORDS,
  }));
}
