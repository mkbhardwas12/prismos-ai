/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** package.json version, injected by vite.config.ts */
  readonly VITE_PRISMOS_VERSION?: string;
  readonly VITE_PRISMOS_BUILD?: string;
}
