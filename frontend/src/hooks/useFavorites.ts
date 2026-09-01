import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, addFavorite, getFavorites, removeFavorite } from '../api';
import type { Favorite, Station } from '../types';

export interface FavoritesState {
  favorites: Favorite[];
  ids: ReadonlySet<string>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isFavorite: (stationId: string) => boolean;
  /** Optimistic toggle: flips locally, calls the server, reverts on failure. */
  toggle: (station: Station) => Promise<void>;
  remove: (stationId: string) => Promise<void>;
}

function stationSnapshot(station: Station, createdAt: string): Favorite {
  return { createdAt, missing: false, station };
}

/**
 * Owns the favorites list + a Set of ids for cheap membership checks. Mutations
 * are optimistic so the heart flips instantly; a rejected request rolls the
 * change back and surfaces the error. `enabled` is false while anonymous so
 * we do not 401-nudge the sign-in modal on every page load.
 */
export function useFavorites(enabled = true): FavoritesState {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setFavorites([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await getFavorites();
      setFavorites(response.favorites);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load favorites.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ids = useMemo(() => new Set(favorites.map((favorite) => favorite.station.id)), [favorites]);

  const isFavorite = useCallback((stationId: string) => ids.has(stationId), [ids]);

  const remove = useCallback(
    async (stationId: string) => {
      const snapshot = favorites;
      setFavorites((current) => current.filter((favorite) => favorite.station.id !== stationId));
      try {
        await removeFavorite(stationId);
      } catch (caught) {
        setFavorites(snapshot);
        setError(caught instanceof ApiError ? caught.message : 'Could not remove favorite.');
      }
    },
    [favorites],
  );

  const toggle = useCallback(
    async (station: Station) => {
      if (ids.has(station.id)) {
        await remove(station.id);
        return;
      }
      const snapshot = favorites;
      const optimistic = stationSnapshot(station, new Date().toISOString());
      setFavorites((current) => [optimistic, ...current.filter((f) => f.station.id !== station.id)]);
      try {
        const saved = await addFavorite(station.id);
        setFavorites((current) => [saved, ...current.filter((f) => f.station.id !== station.id)]);
      } catch (caught) {
        setFavorites(snapshot);
        setError(caught instanceof ApiError ? caught.message : 'Could not save favorite.');
      }
    },
    [favorites, ids, remove],
  );

  return { favorites, ids, loading, error, refresh, isFavorite, toggle, remove };
}
