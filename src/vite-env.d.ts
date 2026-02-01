// /// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly API_KEY: string;
  readonly VITE_API_BASE: string;
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
  [key: string]: any;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
