import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, startQuiz, submitQuiz } from '../api';
import { titleCase } from '../lib/format';
import type {
  Difficulty,
  NotEnoughSpeechResponse,
  QuizStartedResponse,
  QuizSubmitResponse,
  Station,
} from '../types';

type Phase =
  | { name: 'setup' }
  | { name: 'capturing'; startedAt: number }
  | { name: 'answering'; quiz: QuizStartedResponse; answers: (number | null)[] }
  | { name: 'grading' }
  | { name: 'results'; result: QuizSubmitResponse }
  | { name: 'no-speech'; payload: NotEnoughSpeechResponse }
  | { name: 'error'; message: string };

interface QuizPanelProps {
  station: Station;
  quizEnabled: boolean;
  captureSeconds: number;
  targetLanguage: string;
  onClose: () => void;
  onTune: (station: Station) => void;
  onCompleted: () => void;
}

const DIFFICULTIES: { value: Difficulty; title: string; blurb: string }[] = [
  { value: 'beginner', title: 'Beginner', blurb: 'Questions in English — check you caught the gist.' },
  { value: 'intermediate', title: 'Intermediate', blurb: 'Questions in the target language — details matter.' },
];

export function QuizPanel({
  station,
  quizEnabled,
  captureSeconds,
  targetLanguage,
  onClose,
  onTune,
  onCompleted,
}: QuizPanelProps) {
  const [phase, setPhase] = useState<Phase>({ name: 'setup' });
  const [difficulty, setDifficulty] = useState<Difficulty>('beginner');
  const [showTranscript, setShowTranscript] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Reset if the user tunes elsewhere while the panel is open.
  useEffect(() => {
    setPhase({ name: 'setup' });
    setShowTranscript(false);
  }, [station.id]);

  useEffect(() => {
    if (phase.name !== 'capturing') return;
    const timer = window.setInterval(() => setElapsed((Date.now() - phase.startedAt) / 1000), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const begin = useCallback(async () => {
    setElapsed(0);
    setPhase({ name: 'capturing', startedAt: Date.now() });
    try {
      const response = await startQuiz(station.id, difficulty, targetLanguage);
      if (cancelled.current) return;
      if (response.kind === 'not_enough_speech') {
        setPhase({ name: 'no-speech', payload: response });
      } else {
        setPhase({
          name: 'answering',
          quiz: response,
          answers: response.questions.map(() => null),
        });
      }
    } catch (error) {
      if (cancelled.current) return;
      const message =
        error instanceof ApiError ? error.message : 'Something went wrong while building your quiz.';
      setPhase({ name: 'error', message });
    }
  }, [difficulty, station.id, targetLanguage]);

  const choose = useCallback((questionIndex: number, optionIndex: number) => {
    setPhase((current) => {
      if (current.name !== 'answering') return current;
      const answers = [...current.answers];
      answers[questionIndex] = optionIndex;
      return { ...current, answers };
    });
  }, []);

  const submit = useCallback(async () => {
    if (phase.name !== 'answering') return;
    const { quiz, answers } = phase;
    setPhase({ name: 'grading' });
    try {
      const result = await submitQuiz(quiz.quizId, answers);
      if (cancelled.current) return;
      setPhase({ name: 'results', result });
      onCompleted();
    } catch (error) {
      if (cancelled.current) return;
      const message = error instanceof ApiError ? error.message : 'Could not grade that quiz.';
      setPhase({ name: 'error', message });
    }
  }, [phase, onCompleted]);

  const body = useMemo(() => {
    if (!quizEnabled) return <DisabledState />;

    switch (phase.name) {
      case 'setup':
        return (
          <SetupState
            captureSeconds={captureSeconds}
            difficulty={difficulty}
            onDifficulty={setDifficulty}
            onStart={() => void begin()}
            station={station}
            targetLanguage={targetLanguage}
          />
        );
      case 'capturing':
        return <CapturingState captureSeconds={captureSeconds} elapsed={elapsed} station={station} />;
      case 'answering':
        return (
          <AnsweringState
            answers={phase.answers}
            onChoose={choose}
            onSubmit={() => void submit()}
            quiz={phase.quiz}
          />
        );
      case 'grading':
        return (
          <div className="quiz__center">
            <span className="spinner spinner--lg" />
            <p>Marking your answers…</p>
          </div>
        );
      case 'results':
        return (
          <ResultsState
            onAgain={() => setPhase({ name: 'setup' })}
            onToggleTranscript={() => setShowTranscript((value) => !value)}
            result={phase.result}
            showTranscript={showTranscript}
          />
        );
      case 'no-speech':
        return (
          <NoSpeechState
            onRetry={() => void begin()}
            onTune={onTune}
            payload={phase.payload}
            station={station}
          />
        );
      case 'error':
        return (
          <div className="quiz__center">
            <p className="quiz__error-title">That didn’t work</p>
            <p className="quiz__error-message">{phase.message}</p>
            <button type="button" className="button button--accent" onClick={() => void begin()}>
              Try again
            </button>
          </div>
        );
    }
  }, [
    begin,
    captureSeconds,
    choose,
    difficulty,
    elapsed,
    onTune,
    phase,
    quizEnabled,
    showTranscript,
    station,
    submit,
    targetLanguage,
  ]);

  return (
    <aside className="quiz glass" aria-label="Comprehension quiz">
      <header className="quiz__header">
        <div>
          <p className="quiz__eyebrow">Comprehension quiz</p>
          <h2 className="quiz__station">{station.name}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close quiz">
          ✕
        </button>
      </header>
      <div className="quiz__body">{body}</div>
    </aside>
  );
}

function DisabledState() {
  return (
    <div className="quiz__center">
      <div className="quiz__key-icon" aria-hidden="true">
        🔑
      </div>
      <p className="quiz__error-title">Quizzes need Ollama</p>
      <p className="quiz__error-message">
        Install Ollama and run <code>ollama pull qwen2.5:7b-instruct</code>, then restart the server.
        Everything else — the globe, the radio, your stats — works without it.
      </p>
    </div>
  );
}

function SetupState({
  captureSeconds,
  difficulty,
  onDifficulty,
  onStart,
  station,
  targetLanguage,
}: {
  captureSeconds: number;
  difficulty: Difficulty;
  onDifficulty: (value: Difficulty) => void;
  onStart: () => void;
  station: Station;
  targetLanguage: string;
}) {
  return (
    <div className="quiz__setup">
      <p className="quiz__lede">
        We’ll record the next <strong>{captureSeconds} seconds</strong> of {station.name} — the same audio you
        are hearing right now — then ask you four questions about it.
      </p>

      {station.kind === 'music' && (
        <p className="quiz__warning">
          This one is tagged as music. If the clip turns out to be mostly songs we’ll suggest a talk station
          instead.
        </p>
      )}

      <div className="quiz__difficulty" role="radiogroup" aria-label="Difficulty">
        {DIFFICULTIES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={difficulty === option.value}
            className={`quiz__level${difficulty === option.value ? ' quiz__level--active' : ''}`}
            onClick={() => onDifficulty(option.value)}
          >
            <span className="quiz__level-title">{option.title}</span>
            <span className="quiz__level-blurb">
              {option.value === 'intermediate'
                ? `Questions in ${titleCase(targetLanguage)} — details matter.`
                : option.blurb}
            </span>
          </button>
        ))}
      </div>

      <button type="button" className="button button--accent button--block" onClick={onStart}>
        Start listening
      </button>
    </div>
  );
}

function CapturingState({
  captureSeconds,
  elapsed,
  station,
}: {
  captureSeconds: number;
  elapsed: number;
  station: Station;
}) {
  const remaining = Math.max(0, Math.ceil(captureSeconds - elapsed));
  const capturing = elapsed < captureSeconds;
  const progress = Math.min(1, elapsed / captureSeconds);

  const label = capturing
    ? 'Listening along with you — keep listening!'
    : elapsed < captureSeconds + 15
      ? 'Transcribing what we heard…'
      : 'Writing your questions…';

  return (
    <div className="quiz__capture">
      <div className="quiz__ring" style={{ ['--progress' as string]: progress }}>
        <span className="quiz__ring-value">{capturing ? remaining : <span className="spinner spinner--lg" />}</span>
      </div>
      <p className="quiz__capture-label">{label}</p>
      <p className="quiz__capture-hint">
        {capturing
          ? `Pay attention to ${station.name}: who is speaking, what they are talking about, and any numbers or names.`
          : 'This usually takes a few seconds.'}
      </p>
    </div>
  );
}

function AnsweringState({
  answers,
  onChoose,
  onSubmit,
  quiz,
}: {
  answers: (number | null)[];
  onChoose: (questionIndex: number, optionIndex: number) => void;
  onSubmit: () => void;
  quiz: QuizStartedResponse;
}) {
  const answered = answers.filter((answer) => answer !== null).length;

  return (
    <div className="quiz__questions">
      <p className="quiz__progress">
        {answered} of {quiz.questions.length} answered · {quiz.transcriptWords} words heard
      </p>

      {quiz.questions.map((question, questionIndex) => (
        <fieldset className="quiz__question" key={`${quiz.quizId}-${questionIndex}`}>
          <legend className="quiz__question-text">
            <span className="quiz__question-index">{questionIndex + 1}</span>
            {question.question}
          </legend>
          <div className="quiz__options">
            {question.options.map((option, optionIndex) => (
              <button
                key={optionIndex}
                type="button"
                className={`quiz__option${answers[questionIndex] === optionIndex ? ' quiz__option--chosen' : ''}`}
                onClick={() => onChoose(questionIndex, optionIndex)}
                aria-pressed={answers[questionIndex] === optionIndex}
              >
                <span className="quiz__option-letter">{String.fromCharCode(65 + optionIndex)}</span>
                {option}
              </button>
            ))}
          </div>
        </fieldset>
      ))}

      <button
        type="button"
        className="button button--accent button--block"
        onClick={onSubmit}
        disabled={answered === 0}
      >
        {answered < quiz.questions.length ? `Submit ${answered}/${quiz.questions.length}` : 'Submit answers'}
      </button>
    </div>
  );
}

function ResultsState({
  onAgain,
  onToggleTranscript,
  result,
  showTranscript,
}: {
  onAgain: () => void;
  onToggleTranscript: () => void;
  result: QuizSubmitResponse;
  showTranscript: boolean;
}) {
  const ratio = result.total > 0 ? result.score / result.total : 0;
  const verdict = ratio === 1 ? 'Perfect' : ratio >= 0.5 ? 'Not bad' : 'Tough one';

  return (
    <div className="quiz__results">
      <div className="quiz__score">
        <span className="quiz__score-value">
          {result.score}
          <span className="quiz__score-total">/{result.total}</span>
        </span>
        <span className="quiz__score-verdict">{verdict}</span>
      </div>

      {result.results.map((graded, index) => (
        <div
          key={index}
          className={`quiz__review${graded.correct ? ' quiz__review--correct' : ' quiz__review--wrong'}`}
        >
          <p className="quiz__review-question">
            <span className="quiz__question-index">{index + 1}</span>
            {graded.question}
          </p>
          <ul className="quiz__review-options">
            {graded.options.map((option, optionIndex) => {
              const isCorrect = optionIndex === graded.correctIndex;
              const isChosen = optionIndex === graded.chosenIndex;
              return (
                <li
                  key={optionIndex}
                  className={[
                    'quiz__review-option',
                    isCorrect ? 'quiz__review-option--correct' : '',
                    isChosen && !isCorrect ? 'quiz__review-option--chosen' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="quiz__option-letter">{String.fromCharCode(65 + optionIndex)}</span>
                  {option}
                  {isCorrect && <span className="quiz__review-flag">correct</span>}
                  {isChosen && !isCorrect && <span className="quiz__review-flag">you</span>}
                </li>
              );
            })}
          </ul>
          <p className="quiz__review-explanation">{graded.explanation}</p>
        </div>
      ))}

      <button type="button" className="button button--ghost button--block" onClick={onToggleTranscript}>
        {showTranscript ? 'Hide transcript' : 'Read the transcript'}
      </button>
      {showTranscript && <p className="quiz__transcript">{result.transcript}</p>}

      <button type="button" className="button button--accent button--block" onClick={onAgain}>
        Another minute
      </button>
    </div>
  );
}

function NoSpeechState({
  onRetry,
  onTune,
  payload,
  station,
}: {
  onRetry: () => void;
  onTune: (station: Station) => void;
  payload: NotEnoughSpeechResponse;
  station: Station;
}) {
  return (
    <div className="quiz__center quiz__no-speech">
      <div className="quiz__key-icon" aria-hidden="true">
        🎵
      </div>
      <p className="quiz__error-title">That minute was mostly music</p>
      <p className="quiz__error-message">
        We only caught {payload.wordCount} spoken words on {station.name} — not enough to build a fair quiz.
      </p>
      {payload.transcript.length > 0 && <p className="quiz__transcript">“{payload.transcript}”</p>}
      {payload.suggestion && (
        <button
          type="button"
          className="button button--accent button--block"
          onClick={() => onTune(payload.suggestion as Station)}
        >
          Try {payload.suggestion.name} instead
        </button>
      )}
      <button type="button" className="button button--ghost button--block" onClick={onRetry}>
        Record another minute here
      </button>
    </div>
  );
}
