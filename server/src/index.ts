import { ARENAS, PEN_SKINS } from '@pfa/shared';

import { createApp } from './app.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  const server = await createApp();
  const port = await server.listen();
  const storage = server.store.status();

  logger.info('');
  logger.info('  Pen Fight Arena server is up.');
  logger.info(`  API and sockets : http://localhost:${port}`);
  logger.info(`  Arenas          : ${ARENAS.length}   Skins: ${PEN_SKINS.length}`);
  logger.info(`  Storage         : ${storage.kind}`);
  logger.info(`  ${storage.description}`);
  logger.info('');

  if (storage.kind === 'local-json') {
    logger.warn('Worldwide leaderboards need PostgreSQL. See README.md -> "Enabling PostgreSQL".');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received - shutting down.`);
    try {
      await server.close();
    } catch (error) {
      logger.error('Shutdown failed.', error);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.error('Server failed to start.', error);
  process.exitCode = 1;
});
