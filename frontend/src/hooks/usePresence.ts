import { useEffect } from 'react';
import { deletePresence, postPresence } from '../api';
import type { AuthUser, Station } from '../types';

const HEARTBEAT_MS = 60_000;

/**
 * While signed in and a station is actually playing, tell the server so
 * friends can see it. Heartbeat on play-start and every 60s; clear on
 * pause/stop/unmount/sign-out.
 */
export function usePresence(user: AuthUser | null, station: Station | null, playing: boolean): void {
  const stationId = user && station && playing ? station.id : null;

  useEffect(() => {
    if (!stationId) return;

    const beat = () => {
      void postPresence(stationId).catch(() => undefined);
    };

    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);

    return () => {
      window.clearInterval(timer);
      void deletePresence().catch(() => undefined);
    };
  }, [stationId]);
}
