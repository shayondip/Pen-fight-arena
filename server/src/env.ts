import 'dotenv/config';

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim().length > 0 ? raw.trim() : fallback;
}

function readList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export interface AppEnv {
  nodeEnv: string;
  port: number;
  host: string;
  /** Base URL used to build shareable invite links. */
  publicUrl: string;
  /** Allowed browser origins. Empty means "reflect whatever asked", for local dev. */
  corsOrigins: string[];
  databaseUrl: string | null;
  /** Set DISABLE_DATABASE=true to force the local JSON store even if a URL exists. */
  disableDatabase: boolean;
  dataDir: string;
  /** Serve the built client from the API server (used in production deployments). */
  serveClient: boolean;
}

export function loadEnv(): AppEnv {
  const port = readInt('PORT', 4000);
  const host = readString('HOST', '0.0.0.0');
  const databaseUrl = process.env.DATABASE_URL?.trim();

  return {
    nodeEnv: readString('NODE_ENV', 'development'),
    port,
    host,
    publicUrl: readString('PUBLIC_URL', `http://localhost:${readInt('CLIENT_PORT', 5173)}`),
    corsOrigins: readList('CORS_ORIGINS'),
    databaseUrl: databaseUrl && databaseUrl.length > 0 ? databaseUrl : null,
    disableDatabase: readString('DISABLE_DATABASE', 'false').toLowerCase() === 'true',
    dataDir: readString('DATA_DIR', '.data'),
    serveClient: readString('SERVE_CLIENT', 'false').toLowerCase() === 'true',
  };
}
