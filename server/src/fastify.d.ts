import type { AuthStore } from './lib/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    authStore: AuthStore;
  }
}

export {};
