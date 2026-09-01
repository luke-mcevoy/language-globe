import { useEffect, useState } from 'react';
import { getFriendsListening } from '../api';
import type { FriendListening } from '../types';

const POLL_MS = 45_000;

/** Followed users who are live right now, for globe pins. Idle when signed out. */
export function useFriendsListening(enabled: boolean): FriendListening[] {
  const [friends, setFriends] = useState<FriendListening[]>([]);

  useEffect(() => {
    if (!enabled) {
      setFriends([]);
      return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const response = await getFriendsListening();
        if (!cancelled) setFriends(response.friends);
      } catch {
        // Keep the last good set; the next tick retries.
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return friends;
}
