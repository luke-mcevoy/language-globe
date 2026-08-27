import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, startQuiz, submitQuiz } from '../lib/api';
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
  station: Station | null;
  visible: boolean;
  quizEnabled: boolean;
  captureSeconds: number;
  targetLanguage: string;
  onClose: () => void;
  onTune: (station: Station) => void;
  onCompleted: () => void;
}

export function QuizPanel({
  station,
  visible,
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

  useEffect(() => {
    setPhase({ name: 'setup' });
    setShowTranscript(false);
  }, [station?.id, visible]);

  useEffect(() => {
    if (phase.name !== 'capturing') return;
    const timer = setInterval(() => setElapsed((Date.now() - phase.startedAt) / 1000), 250);
    return () => clearInterval(timer);
  }, [phase]);

  const begin = useCallback(async () => {
    if (!station) return;
    setElapsed(0);
    setPhase({ name: 'capturing', startedAt: Date.now() });
    try {
      const response = await startQuiz(station.id, difficulty);
      if (cancelled.current) return;
      if (response.kind === 'not_enough_speech') {
        setPhase({ name: 'no-speech', payload: response });
      } else {
        setPhase({ name: 'answering', quiz: response, answers: response.questions.map(() => null) });
      }
    } catch (error) {
      if (cancelled.current) return;
      setPhase({
        name: 'error',
        message: error instanceof ApiError ? error.message : 'Something went wrong while building your quiz.',
      });
    }
  }, [difficulty, station]);

  const choose = useCallback((questionIndex: number, optionIndex: number) => {
    setPhase((current) => {
      if (current.name !== 'answering') return current;
      const answers = [...current.answers];
      answers[questionIndex] = optionIndex;
      return { ...current, answers };
    });
  }, []);

  const grade = useCallback(async () => {
    if (phase.name !== 'answering') return;
    setPhase({ name: 'grading' });
    try {
      const result = await submitQuiz(phase.quiz.quizId, phase.answers);
      if (cancelled.current) return;
      setPhase({ name: 'results', result });
      onCompleted();
    } catch (error) {
      if (cancelled.current) return;
      setPhase({ name: 'error', message: error instanceof ApiError ? error.message : 'Could not grade that quiz.' });
    }
  }, [onCompleted, phase]);

  if (!station) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>Comprehension quiz</Text>
              <Text style={styles.title} numberOfLines={1}>
                {station.name}
              </Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            {!quizEnabled && <DisabledState />}
            {quizEnabled && phase.name === 'setup' && (
              <SetupState
                captureSeconds={captureSeconds}
                difficulty={difficulty}
                onDifficulty={setDifficulty}
                onStart={() => void begin()}
                station={station}
                targetLanguage={targetLanguage}
              />
            )}
            {quizEnabled && phase.name === 'capturing' && (
              <CapturingState captureSeconds={captureSeconds} elapsed={elapsed} station={station} />
            )}
            {quizEnabled && phase.name === 'answering' && (
              <AnsweringState answers={phase.answers} onChoose={choose} onSubmit={() => void grade()} quiz={phase.quiz} />
            )}
            {quizEnabled && phase.name === 'grading' && <Center title="Marking your answers..." />}
            {quizEnabled && phase.name === 'results' && (
              <ResultsState
                result={phase.result}
                showTranscript={showTranscript}
                onAgain={() => setPhase({ name: 'setup' })}
                onToggleTranscript={() => setShowTranscript((value) => !value)}
              />
            )}
            {quizEnabled && phase.name === 'no-speech' && (
              <NoSpeechState payload={phase.payload} station={station} onRetry={() => void begin()} onTune={onTune} />
            )}
            {quizEnabled && phase.name === 'error' && (
              <Center title="That did not work" detail={phase.message} action="Try again" onAction={() => void begin()} />
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DisabledState() {
  return (
    <Center
      title="Quizzes need a model provider"
      detail="Start local Whisper and Ollama, or add OPENAI_API_KEY to server/.env and restart the server. Radio and progress still work without them."
    />
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
    <View style={styles.stack}>
      <Text style={styles.lede}>
        We will record the next {captureSeconds} seconds of {station.name}, then ask four questions.
      </Text>
      {station.kind === 'music' && (
        <Text style={styles.warning}>This one is tagged as music, so we may suggest a talk station instead.</Text>
      )}
      {(['beginner', 'intermediate'] as const).map((level) => (
        <Pressable
          key={level}
          style={[styles.level, difficulty === level && styles.levelActive]}
          onPress={() => onDifficulty(level)}
        >
          <Text style={styles.levelTitle}>{level === 'beginner' ? 'Beginner' : 'Intermediate'}</Text>
          <Text style={styles.levelBlurb}>
            {level === 'beginner' ? 'Questions in English.' : `Questions in ${titleCase(targetLanguage)}.`}
          </Text>
        </Pressable>
      ))}
      <PrimaryButton label="Start listening" onPress={onStart} />
    </View>
  );
}

function CapturingState({ captureSeconds, elapsed, station }: { captureSeconds: number; elapsed: number; station: Station }) {
  const remaining = Math.max(0, Math.ceil(captureSeconds - elapsed));
  const capturing = elapsed < captureSeconds;
  const progress = Math.min(1, elapsed / captureSeconds);
  return (
    <View style={styles.center}>
      <View style={styles.captureRing}>
        <Text style={styles.captureValue}>{capturing ? remaining : '...'}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.centerTitle}>{capturing ? 'Listening along with you' : 'Writing your questions'}</Text>
      <Text style={styles.centerDetail}>
        {capturing ? `Pay attention to ${station.name}: people, places, numbers and names.` : 'This usually takes a few seconds.'}
      </Text>
    </View>
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
    <View style={styles.stack}>
      <Text style={styles.progressText}>
        {answered} of {quiz.questions.length} answered · {quiz.transcriptWords} words heard
      </Text>
      {quiz.questions.map((question, questionIndex) => (
        <View style={styles.question} key={`${quiz.quizId}-${questionIndex}`}>
          <Text style={styles.questionText}>
            {questionIndex + 1}. {question.question}
          </Text>
          {question.options.map((option, optionIndex) => (
            <Pressable
              key={optionIndex}
              style={[styles.option, answers[questionIndex] === optionIndex && styles.optionChosen]}
              onPress={() => onChoose(questionIndex, optionIndex)}
            >
              <Text style={styles.optionLetter}>{String.fromCharCode(65 + optionIndex)}</Text>
              <Text style={styles.optionText}>{option}</Text>
            </Pressable>
          ))}
        </View>
      ))}
      <PrimaryButton
        disabled={answered === 0}
        label={answered < quiz.questions.length ? `Submit ${answered}/${quiz.questions.length}` : 'Submit answers'}
        onPress={onSubmit}
      />
    </View>
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
  return (
    <View style={styles.stack}>
      <View style={styles.score}>
        <Text style={styles.scoreValue}>
          {result.score}/{result.total}
        </Text>
        <Text style={styles.scoreLabel}>{result.score === result.total ? 'Perfect' : 'Review'}</Text>
      </View>
      {result.results.map((graded, index) => (
        <View key={index} style={[styles.review, graded.correct ? styles.reviewCorrect : styles.reviewWrong]}>
          <Text style={styles.questionText}>
            {index + 1}. {graded.question}
          </Text>
          {graded.options.map((option, optionIndex) => (
            <Text key={optionIndex} style={styles.reviewOption}>
              {String.fromCharCode(65 + optionIndex)}. {option}
              {optionIndex === graded.correctIndex ? '  correct' : ''}
              {optionIndex === graded.chosenIndex && optionIndex !== graded.correctIndex ? '  you' : ''}
            </Text>
          ))}
          <Text style={styles.explanation}>{graded.explanation}</Text>
        </View>
      ))}
      <SecondaryButton label={showTranscript ? 'Hide transcript' : 'Read transcript'} onPress={onToggleTranscript} />
      {showTranscript && <Text style={styles.transcript}>{result.transcript}</Text>}
      <PrimaryButton label="Another minute" onPress={onAgain} />
    </View>
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
    <View style={styles.center}>
      <Text style={styles.centerTitle}>That minute was mostly music</Text>
      <Text style={styles.centerDetail}>
        We only caught {payload.wordCount} spoken words on {station.name}, not enough for a fair quiz.
      </Text>
      {payload.transcript.length > 0 && <Text style={styles.transcript}>{payload.transcript}</Text>}
      {payload.suggestion && <PrimaryButton label={`Try ${payload.suggestion.name}`} onPress={() => onTune(payload.suggestion as Station)} />}
      <SecondaryButton label="Record another minute here" onPress={onRetry} />
    </View>
  );
}

function Center({ title, detail, action, onAction }: { title: string; detail?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.centerTitle}>{title}</Text>
      {detail && <Text style={styles.centerDetail}>{detail}</Text>}
      {action && onAction && <PrimaryButton label={action} onPress={onAction} />}
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.primary, disabled && styles.disabled]} onPress={onPress} disabled={disabled}>
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.secondary} onPress={onPress}>
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.46)',
    justifyContent: 'flex-end',
  },
  panel: {
    maxHeight: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#0a0f1d',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#54e6c3',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  title: {
    color: '#f7fbff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 3,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  closeText: {
    color: '#dce7ff',
    fontSize: 26,
    lineHeight: 28,
  },
  body: {
    padding: 18,
    paddingBottom: 28,
  },
  stack: {
    gap: 14,
  },
  lede: {
    color: '#dbe6fb',
    fontSize: 15,
    lineHeight: 22,
  },
  warning: {
    color: '#ffe59d',
    backgroundColor: 'rgba(255, 206, 103, 0.11)',
    padding: 12,
    borderRadius: 14,
    overflow: 'hidden',
  },
  level: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  levelActive: {
    borderColor: '#54e6c3',
    backgroundColor: 'rgba(84,230,195,0.12)',
  },
  levelTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  levelBlurb: {
    color: '#aebbd5',
    marginTop: 4,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    minHeight: 260,
  },
  centerTitle: {
    color: '#f7fbff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  centerDetail: {
    color: '#aebbd5',
    textAlign: 'center',
    lineHeight: 21,
  },
  captureRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 7,
    borderColor: '#54e6c3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureValue: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
  },
  progressTrack: {
    width: '78%',
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 5,
    backgroundColor: '#54e6c3',
  },
  progressText: {
    color: '#98a4bf',
    fontWeight: '700',
  },
  question: {
    gap: 9,
    paddingBottom: 6,
  },
  questionText: {
    color: '#f7fbff',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  option: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  optionChosen: {
    borderColor: '#8d7dff',
    backgroundColor: 'rgba(141,125,255,0.13)',
  },
  optionLetter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: 'center',
    color: '#07101a',
    backgroundColor: '#dbe7ff',
    fontWeight: '900',
    overflow: 'hidden',
  },
  optionText: {
    flex: 1,
    color: '#dbe7ff',
    lineHeight: 20,
  },
  score: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(84,230,195,0.11)',
  },
  scoreValue: {
    color: '#54e6c3',
    fontSize: 42,
    fontWeight: '900',
  },
  scoreLabel: {
    color: '#f7fbff',
    fontWeight: '800',
  },
  review: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  reviewCorrect: {
    borderColor: 'rgba(84,230,195,0.35)',
    backgroundColor: 'rgba(84,230,195,0.08)',
  },
  reviewWrong: {
    borderColor: 'rgba(255,111,145,0.36)',
    backgroundColor: 'rgba(255,111,145,0.08)',
  },
  reviewOption: {
    color: '#c8d4ee',
    marginTop: 7,
    lineHeight: 19,
  },
  explanation: {
    color: '#aebbd5',
    marginTop: 9,
    lineHeight: 20,
  },
  transcript: {
    color: '#c8d4ee',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    padding: 12,
    lineHeight: 20,
    overflow: 'hidden',
  },
  primary: {
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#54e6c3',
  },
  primaryText: {
    color: '#061018',
    fontWeight: '900',
    fontSize: 15,
  },
  secondary: {
    minHeight: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  secondaryText: {
    color: '#dbe7ff',
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.45,
  },
});
