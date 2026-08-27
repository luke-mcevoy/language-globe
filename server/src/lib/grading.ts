import type { GradedQuestion, QuizQuestion } from '../types.js';

export interface GradeResult {
  score: number;
  total: number;
  results: GradedQuestion[];
}

/**
 * Grades server-side against the stored answer key. `answers` is untrusted
 * client input: it may be short, long, or contain out-of-range indices, and
 * any of those simply count as unanswered rather than throwing.
 */
export function gradeQuiz(questions: QuizQuestion[], answers: unknown): GradeResult {
  const given = Array.isArray(answers) ? answers : [];

  const results: GradedQuestion[] = questions.map((question, index) => {
    const raw = given[index];
    const chosenIndex =
      typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < question.options.length
        ? raw
        : null;

    return {
      question: question.question,
      options: question.options,
      correctIndex: question.correctIndex,
      chosenIndex,
      correct: chosenIndex !== null && chosenIndex === question.correctIndex,
      explanation: question.explanation,
    };
  });

  return {
    score: results.filter((result) => result.correct).length,
    total: questions.length,
    results,
  };
}

/**
 * Validates whatever the LLM returned before it ever reaches the database.
 * Anything malformed is dropped rather than repaired, so a partial response
 * yields a shorter quiz instead of a broken one.
 */
export function parseGeneratedQuestions(payload: unknown): QuizQuestion[] {
  const container = payload as { questions?: unknown } | null;
  const list = Array.isArray(container?.questions) ? container.questions : [];

  const questions: QuizQuestion[] = [];
  for (const entry of list) {
    const item = entry as Partial<QuizQuestion> | null;
    if (!item || typeof item.question !== 'string' || typeof item.explanation !== 'string') continue;
    if (!Array.isArray(item.options) || item.options.length !== 4) continue;
    if (!item.options.every((option): option is string => typeof option === 'string' && option.length > 0)) continue;
    const correctIndex = item.correctIndex;
    if (typeof correctIndex !== 'number' || !Number.isInteger(correctIndex)) continue;
    if (correctIndex < 0 || correctIndex > 3) continue;

    questions.push({
      question: item.question.trim(),
      options: item.options.map((option) => option.trim()),
      correctIndex,
      explanation: item.explanation.trim(),
    });
  }
  return questions;
}
