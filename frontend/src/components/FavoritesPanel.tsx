import { useEffect, useState } from 'react';
import { flagEmoji, isDaytimeAt, localTimeAt, titleCase } from '../lib/format';
import type { Favorite, Station } from '../types';

interface FavoritesPanelProps {
  favorites: Favorite[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onTune: (station: Station) => void;
  onRemove: (stationId: string) => void;
}

function useClock(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function FavoritesPanel({ error, favorites, loading, onClose, onRemove, onTune }: FavoritesPanelProps) {
  const now = useClock();

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Your favorites">
      <button type="button" className="modal__scrim" onClick={onClose} aria-label="Close favorites" />
      <section className="modal__panel glass">
        <header className="modal__header">
          <div>
            <p className="modal__eyebrow">Your favorites</p>
            <h2 className="modal__title">Saved stations</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {loading && (
          <div className="modal__center">
            <span className="spinner spinner--lg" />
            <p>Loading your favorites…</p>
          </div>
        )}

        {error && !loading && (
          <div className="modal__center">
            <p className="quiz__error-title">Could not load favorites</p>
            <p className="quiz__error-message">{error}</p>
          </div>
        )}

        {!loading && !error && favorites.length === 0 && (
          <div className="modal__center modal__empty">
            <div className="quiz__key-icon" aria-hidden="true">
              ♥
            </div>
            <p className="quiz__error-title">No favorites yet</p>
            <p className="quiz__error-message">
              Tap the heart in the player bar to save a station. It shows up here in gold on the globe.
            </p>
          </div>
        )}

        {!loading && !error && favorites.length > 0 && (
          <ul className="favorites">
            {favorites.map((favorite) => {
              const { station } = favorite;
              const place = [station.state, station.country].filter(Boolean).join(', ');
              const daytime = isDaytimeAt(station.lon, now);
              return (
                <li className={`favorites__row${favorite.missing ? ' favorites__row--missing' : ''}`} key={station.id}>
                  <button
                    type="button"
                    className="favorites__tune"
                    onClick={() => onTune(station)}
                    aria-label={`Tune to ${station.name}`}
                  >
                    <span className="favorites__flag" aria-hidden="true">
                      {flagEmoji(station.countryCode)}
                    </span>
                    <span className="favorites__body">
                      <span className="favorites__name" title={station.name}>
                        {station.name}
                      </span>
                      <span className="favorites__meta">
                        {place || 'Unknown location'} · {daytime ? '☀' : '☾'} {localTimeAt(station.lon, now)} local
                        {' · '}
                        <span className={`favorites__kind favorites__kind--${station.kind}`}>
                          {titleCase(station.kind)}
                        </span>
                        {favorite.missing && <span className="favorites__missing"> · offline in the index</span>}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="favorites__remove"
                    onClick={() => onRemove(station.id)}
                    aria-label={`Remove ${station.name} from favorites`}
                    title="Remove from favorites"
                  >
                    <HeartIcon filled />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 20.5s-7.5-4.4-7.5-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 19.5 10.5c0 5.6-7.5 10-7.5 10Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
