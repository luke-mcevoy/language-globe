import { useState } from 'react';

interface WelcomeTourProps {
  onClose: () => void;
  /** Tune a random talk station — the tour's final call to action. */
  onSurprise: () => void;
}

interface TourStep {
  glyph: string;
  title: string;
  body: string;
  hint?: string;
}

const STEPS: TourStep[] = [
  {
    glyph: '🌍',
    title: 'Welcome to Language Globe',
    body: 'Learn a language by listening to the real world. Pick Spanish, Italian, French, or a dozen others from the menu, then spin the globe — every glowing pin is a live radio station.',
    hint: 'Teal pins are talk & news, purple are music. Click the legend in the corner to filter.',
  },
  {
    glyph: '💬',
    title: 'Live captions, word by word',
    body: 'Hit CC while listening and live subtitles appear beneath the globe, highlighted word-by-word in sync with the audio — like karaoke for radio.',
    hint: 'The audio runs slightly behind live so the captions can line up exactly.',
  },
  {
    glyph: '📖',
    title: 'Tap any word you don’t know',
    body: 'Click a word in the captions to pause the radio and see its translation and a quick grammar note. With an account, every word you look up is saved to your personal vocab list.',
  },
  {
    glyph: '✏️',
    title: 'Quiz yourself on what you heard',
    body: 'Press "Quiz me" and the app listens with you for a minute, then asks comprehension questions about what was actually said — not canned exercises.',
    hint: 'Talk & news stations work best for quizzes.',
  },
  {
    glyph: '📈',
    title: 'Track your progress',
    body: 'Your accuracy over time, listening passport of countries, daily streaks, and saved vocab all live under Progress once you create an account.',
  },
  {
    glyph: '✧',
    title: 'Bring your friends',
    body: 'Follow friends, see who is listening right now as gold pins on the globe, and compete on the leaderboard. Everything is free — sign up with just a username.',
  },
];

export function WelcomeTour({ onClose, onSurprise }: WelcomeTourProps) {
  const [step, setStep] = useState(0);
  const current = STEPS[step] ?? (STEPS[0] as TourStep);
  const last = step === STEPS.length - 1;

  return (
    <div className="modal modal--tour" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <button type="button" className="modal__scrim" onClick={onClose} aria-label="Skip tour" />
      <section className="modal__panel modal__panel--narrow glass tour">
        <button type="button" className="icon-button tour__close" onClick={onClose} aria-label="Skip tour">
          ×
        </button>

        <div className="tour__glyph" aria-hidden="true">
          {current.glyph}
        </div>
        <h2 className="tour__title">{current.title}</h2>
        <p className="tour__body">{current.body}</p>
        {current.hint && <p className="tour__hint">{current.hint}</p>}

        <div className="tour__dots" aria-hidden="true">
          {STEPS.map((_, index) => (
            <button
              key={index}
              type="button"
              className={`tour__dot${index === step ? ' tour__dot--on' : ''}`}
              onClick={() => setStep(index)}
              tabIndex={-1}
            />
          ))}
        </div>

        <div className="tour__actions">
          {step > 0 ? (
            <button type="button" className="button glass" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : (
            <button type="button" className="button glass" onClick={onClose}>
              Skip
            </button>
          )}
          {last ? (
            <button
              type="button"
              className="button glass tour__cta"
              onClick={() => {
                onClose();
                onSurprise();
              }}
            >
              ✦ Take me somewhere
            </button>
          ) : (
            <button type="button" className="button glass tour__cta" onClick={() => setStep(step + 1)}>
              Next
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
