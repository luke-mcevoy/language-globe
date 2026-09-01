import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateOllamaQuestions,
  resolveQuizProvider,
  resolveTranscribeProvider,
  type ProviderProbeState,
} from '../src/services/providers.js';

const none: ProviderProbeState = {
  localWhisperAvailable: false,
  ollamaAvailable: false,
};

describe('provider selection', () => {
  it('auto uses local whisper when present and is otherwise unavailable', () => {
    expect(resolveTranscribeProvider('auto', { ...none, localWhisperAvailable: true })).toBe('local-whisper');
    expect(resolveTranscribeProvider('auto', none)).toBe('unavailable');
  });

  it('forced local transcription is unavailable without whisper.cpp', () => {
    expect(resolveTranscribeProvider('local', { ...none, localWhisperAvailable: true })).toBe('local-whisper');
    expect(resolveTranscribeProvider('local', none)).toBe('unavailable');
  });

  it('unknown transcribe modes collapse to auto', () => {
    expect(resolveTranscribeProvider('cloud', { ...none, localWhisperAvailable: true })).toBe('local-whisper');
    expect(resolveTranscribeProvider('cloud', none)).toBe('unavailable');
  });

  it('auto uses Ollama when present and is otherwise unavailable', () => {
    expect(resolveQuizProvider('auto', { ...none, ollamaAvailable: true })).toBe('ollama');
    expect(resolveQuizProvider('auto', none)).toBe('unavailable');
  });

  it('forced Ollama is unavailable when the model is missing', () => {
    expect(resolveQuizProvider('ollama', { ...none, ollamaAvailable: true })).toBe('ollama');
    expect(resolveQuizProvider('ollama', none)).toBe('unavailable');
  });

  it('unknown quiz modes collapse to auto', () => {
    expect(resolveQuizProvider('cloud', { ...none, ollamaAvailable: true })).toBe('ollama');
    expect(resolveQuizProvider('cloud', none)).toBe('unavailable');
  });
});

describe('generateOllamaQuestions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses Ollama JSON-schema chat content through the quiz validator', async () => {
    const payload = {
      questions: [
        {
          question: 'What does the presenter discuss?',
          options: ['Weather', 'Traffic', 'Sports', 'Cooking'],
          correctIndex: 1,
          explanation: 'The presenter mentions road delays.',
        },
        {
          question: 'Where is the report focused?',
          options: ['Madrid', 'Seville', 'Valencia', 'Bilbao'],
          correctIndex: 0,
          explanation: 'Madrid is named in the transcript.',
        },
        {
          question: 'Malformed entry is dropped',
          options: ['a', 'b'],
          correctIndex: 0,
          explanation: 'Bad options.',
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify(payload) } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const questions = await generateOllamaQuestions('Tráfico en Madrid.', 'beginner');

    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: 'POST' }));
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      question: 'What does the presenter discuss?',
      correctIndex: 1,
    });
  });
});
