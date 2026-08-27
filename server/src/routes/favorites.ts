import type { FastifyInstance } from 'fastify';
import { CURRENT_USER_ID, favoritesStore } from '../db.js';
import type { FavoriteRecord } from '../lib/favorites.js';
import { getStations } from '../services/stations.js';
import type { Favorite, FavoritesResponse, Station, StationKind } from '../types.js';

const STATION_KINDS: readonly StationKind[] = ['talk', 'music', 'unknown'];

/**
 * Reconstruct a Station from the snapshot fields we stored at favorite time.
 * The globe still needs enough of a Station shape to render a pin and let the
 * user tune it even after Radio Browser has dropped the row.
 */
function stationFromRecord(record: FavoriteRecord): Station {
  const kind: StationKind = STATION_KINDS.includes(record.kind) ? record.kind : 'unknown';
  return {
    id: record.station_id,
    name: record.station_name,
    url: record.url,
    homepage: '',
    favicon: '',
    tags: [],
    country: record.country,
    countryCode: record.country_code,
    state: '',
    language: '',
    lat: record.lat,
    lon: record.lon,
    clickcount: 0,
    votes: 0,
    codec: '',
    bitrate: 0,
    kind,
    reachable: false,
  };
}

async function hydrate(records: FavoriteRecord[]): Promise<Favorite[]> {
  if (records.length === 0) return [];
  const live = new Map<string, Station>();
  try {
    const { stations } = await getStations();
    for (const station of stations) live.set(station.id, station);
  } catch {
    // Stations index is down; every favorite still renders from its snapshot.
  }
  return records.map((record) => {
    const station = live.get(record.station_id);
    return {
      createdAt: record.created_at,
      missing: !station,
      station: station ?? stationFromRecord(record),
    };
  });
}

export async function registerFavoriteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/favorites', async (): Promise<FavoritesResponse> => {
    const records = favoritesStore.list(CURRENT_USER_ID);
    const favorites = await hydrate(records);
    return { favorites };
  });

  app.put<{ Params: { stationId: string } }>('/api/favorites/:stationId', async (request, reply) => {
    const stationId = request.params.stationId;
    if (!stationId) {
      return reply.status(400).send({ error: 'bad_request', message: 'stationId is required.' });
    }

    let station: Station | undefined;
    try {
      const { stations } = await getStations();
      station = stations.find((candidate) => candidate.id === stationId);
    } catch (error) {
      request.log.warn({ err: error, stationId }, 'station index unavailable while adding favorite');
      return reply.status(502).send({
        error: 'stations_unavailable',
        message: 'Could not reach the station index. Try again in a moment.',
      });
    }

    if (!station) {
      return reply.status(404).send({ error: 'unknown_station', message: 'That station is no longer in the index.' });
    }

    const record = favoritesStore.add({ station, userId: CURRENT_USER_ID });
    const favorite: Favorite = { createdAt: record.created_at, missing: false, station };
    return favorite;
  });

  app.delete<{ Params: { stationId: string } }>('/api/favorites/:stationId', async (request, reply) => {
    favoritesStore.remove(CURRENT_USER_ID, request.params.stationId);
    return reply.status(204).send();
  });
}
