// Manually define ImportMetaEnv since 'vite/client' types are missing
interface ImportMetaEnv {
  [key: string]: any;
  readonly API_KEY: string;
  BASE_URL: string;
  MODE: string;
  DEV: boolean;
  PROD: boolean;
  SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}