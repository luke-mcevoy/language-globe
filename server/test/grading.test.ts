import { describe, expect, it } from 'vitest';
import { gradeQuiz, parseGeneratedQuestions } from '../src/lib/grading.js';
import type { QuizQuestion } from '../src/types.js';

const questions: QuizQuestion[] = [
  { question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 2, explanation: 'because c' },
  { question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'because a' },
  { question: 'Q3', options: ['a', 'b', 'c', 'd'], correctIndex: 3, explanation: 'because d' },
];

describe('gradeQuiz', () => {
  it('scores a fully correct submission', () => {
    const graded = gradeQuiz(questions, [2, 0, 3]);
    expect(graded.score).toBe(3);
    expect(graded.total).toBe(3);
    expect(graded.results.every((result) => result.correct)).toBe(true);
  });

  it('scores a mixed submission and keeps the answer key and explanations', () => {
    const graded = gradeQuiz(questions, [2, 1, 3]);
    expect(graded.score).toBe(2);
    expect(graded.results[1]).toMatchObject({
      chosenIndex: 1,
      correctIndex: 0,
      correct: false,
      explanation: 'because a',
    });
  });

  it('treats missing answers as unanswered rather than wrong indices', () => {
    const graded = gradeQuiz(questions, [2]);
    expect(graded.score).toBe(1);
    expect(graded.results[1]?.chosenIndex).toBeNull();
    expect(graded.results[2]?.chosenIndex).toBeNull();
  });

  it('rejects out-of-range, non-integer and non-array client input', () => {
    expect(gradeQuiz(questions, [9, -1, 1.5]).score).toBe(0);
    expect(gradeQuiz(questions, [9, -1, 1.5]).results[0]?.chosenIndex).toBeNull();
    expect(gradeQuiz(questions, 'cheat').score).toBe(0);
    expect(gradeQuiz(questions, null).results).toHaveLength(3);
  });

  it('ignores extra answers beyond the question count', () => {
    const graded = gradeQuiz(questions, [2, 0, 3, 1, 1]);
    expect(graded.total).toBe(3);
    expect(graded.results).toHaveLength(3);
  });

  it('handles an empty quiz without dividing by zero', () => {
    expect(gradeQuiz([], [])).toEqual({ score: 0, total: 0, results: [] });
  });
});

describe('parseGeneratedQuestions', () => {
  const valid = {
    question: 'What is the topic?',
    options: ['one', 'two', 'three', 'four'],
    correctIndex: 1,
    explanation: 'The host says so.',
  };

  it('accepts a well-formed model response', () => {
    expect(parseGeneratedQuestions({ questions: [valid] })).toEqual([valid]);
  });

  it('trims whitespace from the model output', () => {
    const [parsed] = parseGeneratedQuestions({
      questions: [{ ...valid, question: '  padded?  ', options: [' a ', 'b', 'c', 'd'] }],
    });
    expect(parsed?.question).toBe('padded?');
    expect(parsed?.options[0]).toBe('a');
  });

  it('drops malformed entries instead of throwing', () => {
    const parsed = parseGeneratedQuestions({
      questions: [
        valid,
        { ...valid, options: ['only', 'three', 'here'] },
        { ...valid, correctIndex: 7 },
        { ...valid, correctIndex: '1' },
        { ...valid, explanation: undefined },
        null,
        'nonsense',
      ],
    });
    expect(parsed).toHaveLength(1);
  });

  it('returns an empty list for junk payloads', () => {
    expect(parseGeneratedQuestions(null)).toEqual([]);
    expect(parseGeneratedQuestions({})).toEqual([]);
    expect(parseGeneratedQuestions({ questions: 'nope' })).toEqual([]);
  });
});
