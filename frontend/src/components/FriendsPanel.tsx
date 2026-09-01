import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, followUser, getLeaderboard, unfollowUser } from '../api';
import { formatPercent } from '../lib/format';
import type { AuthUser, LeaderboardEntry } from '../types';

interface FriendsPanelProps {
  me: AuthUser;
  onClose: () => void;
}

export function FriendsPanel({ me, onClose }: FriendsPanelProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [followError, setFollowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await getLeaderboard();
      setEntries(response.entries);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the leaderboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const onFollow = async (event: FormEvent) => {
    event.preventDefault();
    const target = username.trim();
    if (target.length === 0) return;
    setFollowError(null);
    setBusy(true);
    try {
      await followUser(target);
      setUsername('');
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 404 || caught.code === 'unknown_user')) {
        setFollowError('no such user');
      } else {
        setFollowError(caught instanceof ApiError ? caught.message : 'Could not follow that user.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onUnfollow = async (target: string) => {
    try {
      await unfollowUser(target);
      await refresh();
    } catch (caught) {
      setFollowError(caught instanceof ApiError ? caught.message : 'Could not unfollow.');
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Friends">
      <button type="button" className="modal__scrim" onClick={onClose} aria-label="Close friends" />
      <section className="modal__panel modal__panel--friends glass">
        <header className="modal__header">
          <div>
            <p className="modal__eyebrow">Together</p>
            <h2 className="modal__title">Friends</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form className="friends__add" onSubmit={(event) => void onFollow(event)}>
          <label className="field field--row">
            <span className="visually-hidden">Username to follow</span>
            <input
              name="followUsername"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Add friend by username"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setFollowError(null);
              }}
            />
          </label>
          <button type="submit" className="button button--accent" disabled={busy || username.trim().length === 0}>
            Follow
          </button>
        </form>
        {followError && <p className="friends__follow-error">{followError}</p>}

        {loading && (
          <div className="modal__center">
            <span className="spinner spinner--lg" />
            <p>Loading the leaderboard…</p>
          </div>
        )}

        {error && !loading && (
          <div className="modal__center">
            <p className="quiz__error-title">Could not load friends</p>
            <p className="quiz__error-message">{error}</p>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="modal__center modal__empty">
            <p className="quiz__error-title">Just you so far</p>
            <p className="quiz__error-message">Follow someone by exact username to see their streak and what they are listening to.</p>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <ul className="friends">
            {entries.map((entry) => {
              const isMe = entry.userId === me.id;
              return (
                <li
                  className={`friends__row${entry.listeningNow ? ' friends__row--live' : ''}`}
                  data-username={entry.username}
                  key={entry.userId}
                >
                  <div className="friends__identity">
                    <p className="friends__name">
                      {entry.displayName}
                      {isMe && <span className="friends__you">you</span>}
                      <span className="friends__username">@{entry.username}</span>
                    </p>
                    <p className="friends__stats">
                      <span>🔥 {entry.streakDays}</span>
                      <span>{entry.quizCount} quizzes</span>
                      <span>{formatPercent(entry.accuracy7d)} accuracy</span>
                      <span>{entry.vocabCount} vocab</span>
                      <span>{entry.countriesCount} countries</span>
                    </p>
                    {entry.listeningNow && (
                      <p className="friends__listening">
                        listening to {entry.listeningNow.stationName} · {entry.listeningNow.country}
                      </p>
                    )}
                  </div>
                  {!isMe && (
                    <button
                      type="button"
                      className="friends__unfollow"
                      onClick={() => void onUnfollow(entry.username)}
                      aria-label={`Unfollow ${entry.username}`}
                      title="Unfollow"
                    >
                      Unfollow
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
