import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateOllamaQuestions,
  resolveQuizProvider,
  resolveTranscribeProvider,
  type ProviderProbeState,
} from '../src/services/providers.js';

const none: ProviderProbeState = {
  openaiAvailable: false,
  localWhisperAvailable: false,
  ollamaAvailable: false,
};

describe('provider selection', () => {
  it('auto prefers local transcription, then OpenAI, then unavailable', () => {
    expect(resolveTranscribeProvider('auto', { ...none, openaiAvailable: true, localWhisperAvailable: true })).toBe(
      'local-whisper',
    );
    expect(resolveTranscribeProvider('auto', { ...none, openaiAvailable: true })).toBe('openai');
    expect(resolveTranscribeProvider('auto', none)).toBe('unavailable');
  });

  it('forced local transcription falls back to OpenAI when local Whisper is missing', () => {
    expect(resolveTranscribeProvider('local', { ...none, localWhisperAvailable: true })).toBe('local-whisper');
    expect(resolveTranscribeProvider('local', { ...none, openaiAvailable: true })).toBe('openai');
    expect(resolveTranscribeProvider('local', none)).toBe('unavailable');
  });

  it('forced OpenAI transcription is unavailable without a key', () => {
    expect(resolveTranscribeProvider('openai', { ...none, openaiAvailable: true, localWhisperAvailable: true })).toBe(
      'openai',
    );
    expect(resolveTranscribeProvider('openai', { ...none, localWhisperAvailable: true })).toBe('unavailable');
  });

  it('auto prefers Ollama quiz generation, then OpenAI, then unavailable', () => {
    expect(resolveQuizProvider('auto', { ...none, openaiAvailable: true, ollamaAvailable: true })).toBe('ollama');
    expect(resolveQuizProvider('auto', { ...none, openaiAvailable: true })).toBe('openai');
    expect(resolveQuizProvider('auto', none)).toBe('unavailable');
  });

  it('forced Ollama quiz generation falls back to OpenAI when Ollama is missing', () => {
    expect(resolveQuizProvider('ollama', { ...none, ollamaAvailable: true })).toBe('ollama');
    expect(resolveQuizProvider('ollama', { ...none, openaiAvailable: true })).toBe('openai');
    expect(resolveQuizProvider('ollama', none)).toBe('unavailable');
  });

  it('forced OpenAI quiz generation is unavailable without a key', () => {
    expect(resolveQuizProvider('openai', { ...none, openaiAvailable: true, ollamaAvailable: true })).toBe('openai');
    expect(resolveQuizProvider('openai', { ...none, ollamaAvailable: true })).toBe('unavailable');
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
