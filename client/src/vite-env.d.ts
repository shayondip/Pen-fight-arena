/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute URL of the game server. Leave unset in dev: Vite proxies instead. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
