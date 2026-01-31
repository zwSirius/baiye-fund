// Manually define ImportMetaEnv since 'vite/client' types are missing
interface ImportMetaEnv {
  [key: string]: any;
  readonly API_KEY: string;
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
