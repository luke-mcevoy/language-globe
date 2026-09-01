import type { FastifyInstance } from 'fastify';
import { SocialError, buildLeaderboard } from '../lib/social.js';
import { requireUser } from '../lib/resolveUser.js';
import { findStation, getStations } from '../services/stations.js';
import type { FriendListening, FriendsListeningResponse, LeaderboardResponse, Station } from '../types.js';

interface FollowBody {
  username?: unknown;
}

interface PresenceBody {
  stationId?: unknown;
}

export interface SocialRouteLookups {
  findStation?: (stationId: string) => Promise<Station | undefined>;
  getStations?: () => Promise<{ stations: Station[] }>;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function statusFor(error: SocialError): number {
  switch (error.code) {
    case 'unknown_user':
      return 404;
    case 'cannot_follow_self':
      return 400;
    default:
      return 400;
  }
}

export async function registerSocialRoutes(
  app: FastifyInstance,
  lookups: SocialRouteLookups = {},
): Promise<void> {
  const resolveStation = lookups.findStation ?? findStation;
  const loadStations = lookups.getStations ?? getStations;

  app.post<{ Body: FollowBody }>('/api/social/follow', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    try {
      request.server.socialStore.follow(user.id, readString(request.body?.username));
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof SocialError) {
        return reply.status(statusFor(error)).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.delete<{ Params: { username: string } }>('/api/social/follow/:username', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    try {
      request.server.socialStore.unfollow(user.id, request.params.username);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof SocialError) {
        return reply.status(statusFor(error)).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get('/api/social/leaderboard', async (request, reply): Promise<LeaderboardResponse | undefined> => {
    const user = requireUser(request, reply);
    if (!user) return;
    return { entries: buildLeaderboard(user, request.server.socialStore, request.server.presenceStore) };
  });

  app.post<{ Body: PresenceBody }>('/api/social/presence', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    const stationId = readString(request.body?.stationId).trim();
    if (!stationId) {
      return reply.status(400).send({ error: 'bad_request', message: 'stationId is required.' });
    }

    let station: Station | undefined;
    try {
      station = await resolveStation(stationId);
    } catch (error) {
      request.log.warn({ err: error, stationId }, 'station index unavailable while recording presence');
      return reply.status(502).send({
        error: 'stations_unavailable',
        message: 'Could not reach the station index. Try again in a moment.',
      });
    }

    if (!station) {
      return reply.status(404).send({ error: 'unknown_station', message: 'That station is no longer in the index.' });
    }

    request.server.presenceStore.heartbeat(user.id, {
      id: station.id,
      name: station.name,
      country: station.country,
    });
    return reply.status(204).send();
  });

  app.delete('/api/social/presence', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    request.server.presenceStore.stop(user.id);
    return reply.status(204).send();
  });

  app.get('/api/social/friends-listening', async (request, reply): Promise<FriendsListeningResponse | undefined> => {
    const user = requireUser(request, reply);
    if (!user) return;

    const followed = request.server.socialStore.following(user.id);
    const live = request.server.presenceStore.list(followed.map((friend) => friend.id));

    let index = new Map<string, Station>();
    try {
      const { stations } = await loadStations();
      index = new Map(stations.map((station) => [station.id, station]));
    } catch (error) {
      request.log.warn({ err: error }, 'station index unavailable while listing friends listening');
    }

    const friends: FriendListening[] = [];
    for (const friend of followed) {
      const presence = live.get(friend.id);
      if (!presence) continue;
      const station = index.get(presence.stationId);
      if (!station) continue;
      friends.push({
        userId: friend.id,
        username: friend.username,
        displayName: friend.displayName,
        stationId: presence.stationId,
        stationName: presence.stationName,
        country: presence.country,
        lat: station.lat,
        lon: station.lon,
        startedAt: presence.startedAt,
      });
    }
    return { friends };
  });
}
