import { useCallback, useEffect, useState } from 'react';
import { getMe, login, logout, setAccountRequiredHandler, signup } from '../api';
import type { AuthUser } from '../types';

export type AuthTab = 'login' | 'signup';

export const ACCOUNT_NUDGE = 'Create a free account on this server to save your progress';

export interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  modalOpen: boolean;
  nudge: string | null;
  defaultTab: AuthTab;
  openModal: (options?: { nudge?: string; tab?: AuthTab }) => void;
  closeModal: () => void;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const [defaultTab, setDefaultTab] = useState<AuthTab>('login');

  useEffect(() => {
    let cancelled = false;
    void getMe()
      .then((response) => {
        if (!cancelled) setUser(response.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openModal = useCallback((options?: { nudge?: string; tab?: AuthTab }) => {
    setNudge(options?.nudge ?? null);
    setDefaultTab(options?.tab ?? (options?.nudge ? 'signup' : 'login'));
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setNudge(null);
  }, []);

  useEffect(() => {
    setAccountRequiredHandler((message) => {
      openModal({ nudge: message, tab: 'signup' });
    });
    return () => setAccountRequiredHandler(null);
  }, [openModal]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const response = await login(username, password);
      setUser(response.user);
      closeModal();
    },
    [closeModal],
  );

  const signUp = useCallback(
    async (username: string, password: string, displayName?: string) => {
      const response = await signup(username, password, displayName);
      setUser(response.user);
      closeModal();
    },
    [closeModal],
  );

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setUser(null);
    }
  }, []);

  return {
    user,
    ready,
    modalOpen,
    nudge,
    defaultTab,
    openModal,
    closeModal,
    signIn,
    signUp,
    signOut,
  };
}
