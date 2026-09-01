import type { AuthStore } from './lib/auth.js';
import type { PresenceStore, SocialStore } from './lib/social.js';

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
    socialStore: SocialStore;
    presenceStore: PresenceStore;
  }
}

export {};
