import type { AppEnv } from '../env.js';
import { logger } from '../logger.js';
import { JsonStore } from './jsonStore.js';
import { PrismaStore, createPrismaClient } from './prismaStore.js';
import type { Store } from './types.js';

export * from './types.js';
export { JsonStore } from './jsonStore.js';
export { PrismaStore } from './prismaStore.js';

/**
 * Picks the storage backend.
 *
 * PostgreSQL is used whenever DATABASE_URL is set and the connection actually
 * succeeds. If it is missing or unreachable we fall back to the local JSON
 * store and log exactly why, so local-only data is never quietly presented as
 * a worldwide database.
 */
export async function createStore(env: AppEnv): Promise<Store> {
  if (env.disableDatabase) {
    logger.info('DISABLE_DATABASE=true - using the local JSON development store.');
    const store = new JsonStore(env.dataDir);
    await store.init();
    return store;
  }

  if (env.databaseUrl) {
    const client = await createPrismaClient(env.databaseUrl);
    if (client) {
      const store = new PrismaStore(client);
      try {
        await store.init();
        logger.info('Connected to PostgreSQL. Accounts and rankings are shared across players.');
        return store;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`PostgreSQL responded but the schema is not ready: ${message}`);
        logger.warn('Run "npm run prisma:push" to create the tables. Falling back to local JSON.');
        await store.close().catch(() => undefined);
      }
    }
  } else {
    logger.info('No DATABASE_URL set - running with the local JSON development store.');
  }

  const fallback = new JsonStore(env.dataDir);
  await fallback.init();
  logger.warn(
    'LOCAL MODE: profiles, match history and the leaderboard live in a file on this machine only.',
  );
  return fallback;
}
