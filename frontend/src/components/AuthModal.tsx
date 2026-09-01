import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import type { AuthTab } from '../hooks/useAuth';

interface AuthModalProps {
  defaultTab: AuthTab;
  nudge: string | null;
  onClose: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
  onSignup: (username: string, password: string, displayName?: string) => Promise<void>;
}

export function AuthModal({ defaultTab, nudge, onClose, onLogin, onSignup }: AuthModalProps) {
  const [tab, setTab] = useState<AuthTab>(defaultTab);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === 'signup') {
        await onSignup(username.trim(), password, displayName.trim() || undefined);
      } else {
        await onLogin(username.trim(), password);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal modal--auth" role="dialog" aria-modal="true" aria-label="Sign in">
      <button type="button" className="modal__scrim" onClick={onClose} aria-label="Close sign in" />
      <section className="modal__panel modal__panel--narrow glass">
        <header className="modal__header">
          <div>
            <p className="modal__eyebrow">This server</p>
            <h2 className="modal__title">{tab === 'signup' ? 'Create an account' : 'Welcome back'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form className="auth" onSubmit={(event) => void submit(event)}>
          <div className="auth__tabs" role="tablist" aria-label="Account">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'login'}
              className={tab === 'login' ? 'auth__tab auth__tab--active' : 'auth__tab'}
              onClick={() => {
                setTab('login');
                setError(null);
              }}
            >
              Login
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signup'}
              className={tab === 'signup' ? 'auth__tab auth__tab--active' : 'auth__tab'}
              onClick={() => {
                setTab('signup');
                setError(null);
              }}
            >
              Signup
            </button>
          </div>

          {nudge && <p className="auth__nudge">{nudge}</p>}

          <label className="field">
            <span>Username</span>
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="your_name"
              required
              minLength={3}
              maxLength={20}
              pattern="[a-zA-Z0-9_]{3,20}"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </label>

          {tab === 'signup' && (
            <label className="field">
              <span>Display name <em>(optional)</em></span>
              <input
                name="displayName"
                autoComplete="nickname"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="How friends see you"
                maxLength={40}
              />
            </label>
          )}

          {error && <p className="auth__error">{error}</p>}

          <button type="submit" className="button button--accent button--block" disabled={busy}>
            {busy ? 'Please wait…' : tab === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </form>
      </section>
    </div>
  );
}
