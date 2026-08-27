import { useEffect, useState } from 'react';
import { flagEmoji, isDaytimeAt, localTimeAt } from '../lib/format';
import type { Radio } from '../hooks/useRadio';

interface PlayerBarProps {
  radio: Radio;
  captionsEnabled: boolean;
  captionsOpen: boolean;
  quizEnabled: boolean;
  quizOpen: boolean;
  onCaptions: () => void;
  onQuiz: () => void;
}

function useClock(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'Nothing playing',
  loading: 'Connecting…',
  playing: 'On air',
  paused: 'Paused',
  error: 'Stream failed',
};

export function PlayerBar({
  captionsEnabled,
  captionsOpen,
  onCaptions,
  onQuiz,
  quizEnabled,
  quizOpen,
  radio,
}: PlayerBarProps) {
  const now = useClock();
  const { station, status } = radio;

  if (!station) {
    return (
      <footer className="player player--empty glass">
        <p className="player__hint">
          Pick a glowing station on the globe to start listening — or hit <strong>Surprise me</strong>.
        </p>
      </footer>
    );
  }

  const place = [station.state, station.country].filter(Boolean).join(', ');
  const daytime = isDaytimeAt(station.lon, now);

  return (
    <footer className="player glass">
      <button
        type="button"
        className="player__play"
        onClick={status === 'error' ? radio.retry : radio.toggle}
        aria-label={status === 'playing' ? 'Pause' : 'Play'}
        data-status={status}
      >
        {status === 'loading' ? <span className="spinner" /> : null}
        {status === 'playing' ? <PauseIcon /> : null}
        {status === 'error' ? <RetryIcon /> : null}
        {status === 'paused' || status === 'idle' ? <PlayIcon /> : null}
      </button>

      <div className="player__identity">
        <div className="player__name-row">
          <span className={`player__pulse player__pulse--${status}`} aria-hidden="true" />
          <h2 className="player__name" title={station.name}>
            {station.name}
          </h2>
          <span className="player__codec">
            {station.codec}
            {station.bitrate > 0 ? ` ${station.bitrate}k` : ''}
          </span>
        </div>
        <div className="player__meta">
          <span className="player__place">
            {flagEmoji(station.countryCode)} {place || 'Unknown location'}
          </span>
          <span className="player__dot">·</span>
          <span className="player__time">
            {daytime ? '☀' : '☾'} {localTimeAt(station.lon, now)} local
          </span>
          {station.tags.length > 0 && (
            <>
              <span className="player__dot">·</span>
              <span className="player__tags">{station.tags.slice(0, 3).join(' · ')}</span>
            </>
          )}
        </div>
        <p className="player__status" data-status={status}>
          {radio.error ?? STATUS_LABEL[status] ?? ''}
        </p>
      </div>

      <div className="player__volume">
        <button type="button" onClick={radio.toggleMute} aria-label={radio.muted ? 'Unmute' : 'Mute'}>
          {radio.muted || radio.volume === 0 ? '🔇' : radio.volume < 0.5 ? '🔉' : '🔊'}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={radio.muted ? 0 : radio.volume}
          onChange={(event) => radio.setVolume(Number(event.target.value))}
          aria-label="Volume"
        />
      </div>

      <button
        type="button"
        className={`button player__cc${captionsOpen ? ' player__cc--active' : ''}`}
        onClick={onCaptions}
        disabled={!captionsEnabled}
        aria-pressed={captionsOpen}
        title={captionsEnabled ? 'Toggle live captions' : 'Needs local Whisper or an OpenAI API key'}
      >
        CC
      </button>

      <button
        type="button"
        className="button button--accent player__quiz"
        onClick={onQuiz}
        disabled={!quizEnabled || quizOpen}
        title={quizEnabled ? 'Capture a minute of this station and quiz yourself' : 'Needs local models or an OpenAI API key'}
      >
        Quiz me
      </button>
    </footer>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M12 5a7 7 0 1 0 6.6 4.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M19.5 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
