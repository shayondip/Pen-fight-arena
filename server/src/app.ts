import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { Server as SocketServer } from 'socket.io';

import { RoomManager } from './game/rooms.js';
import { initPhysics } from './game/world.js';
import { createApiRouter } from './http/api.js';
import { loadEnv } from './env.js';
import type { AppEnv } from './env.js';
import { logger } from './logger.js';
import { attachSocketHandlers, createBroadcaster } from './net/socket.js';
import type { GameSocketServer } from './net/socket.js';
import { createStore } from './store/index.js';
import type { Store } from './store/types.js';

export interface RunningServer {
  app: Express;
  httpServer: HttpServer;
  io: GameSocketServer;
  store: Store;
  rooms: RoomManager;
  env: AppEnv;
  /** Actual bound port - useful when the server was started on port 0. */
  port: number;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

function applyCors(app: Express, origins: string[]): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const allowed = origins.length === 0 || (origin ? origins.includes(origin) : false);

    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else if (origins.length === 0) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-pfa-secret');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

/**
 * Builds the whole server without starting it.
 *
 * Tests call this directly and listen on port 0, which is how the multiplayer
 * suite drives two real Socket.IO clients against a real physics loop.
 */
export async function createApp(overrides: Partial<AppEnv> = {}): Promise<RunningServer> {
  const env: AppEnv = { ...loadEnv(), ...overrides };

  await initPhysics();
  const store = await createStore(env);

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  applyCors(app, env.corsOrigins);
  app.use('/api', createApiRouter(store));

  if (env.serveClient) {
    const here = dirname(fileURLToPath(import.meta.url));
    const clientDist = resolve(here, '../../client/dist');
    if (existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
          next();
          return;
        }
        res.sendFile(join(clientDist, 'index.html'));
      });
      logger.info(`Serving the built client from ${clientDist}`);
    } else {
      logger.warn(`SERVE_CLIENT=true but ${clientDist} does not exist. Run "npm run build" first.`);
    }
  }

  const httpServer = createServer(app);
  const io: GameSocketServer = new SocketServer(httpServer, {
    cors: {
      origin: env.corsOrigins.length > 0 ? env.corsOrigins : true,
      methods: ['GET', 'POST'],
    },
    // Pens move fast; keep the transport snappy but tolerant of a slow laptop.
    pingInterval: 10_000,
    pingTimeout: 20_000,
  });

  const broadcaster = createBroadcaster(io);
  const rooms = new RoomManager(store, broadcaster, env.publicUrl);
  attachSocketHandlers(io, store, rooms);

  let boundPort = env.port;

  const server: RunningServer = {
    app,
    httpServer,
    io,
    store,
    rooms,
    env,
    get port() {
      return boundPort;
    },
    listen(port = env.port) {
      return new Promise<number>((resolvePromise, rejectPromise) => {
        httpServer.once('error', rejectPromise);
        httpServer.listen(port, env.host, () => {
          const address = httpServer.address();
          boundPort = typeof address === 'object' && address ? address.port : port;
          httpServer.off('error', rejectPromise);
          resolvePromise(boundPort);
        });
      });
    },
    async close() {
      rooms.shutdown();
      await new Promise<void>((resolvePromise) => {
        io.close(() => resolvePromise());
      });
      await new Promise<void>((resolvePromise) => {
        httpServer.close(() => resolvePromise());
      });
      await store.close();
    },
  };

  return server;
}
