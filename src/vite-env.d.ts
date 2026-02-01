/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly API_KEY: string;
  readonly VITE_API_BASE: string;
  // allow other env vars
  [key: string]: any;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
