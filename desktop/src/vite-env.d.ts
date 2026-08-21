/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOTEBOOKLM_ENV?: "development" | "production";
  readonly VITE_NOTEBOOKLM_API_BASE?: string;
}
