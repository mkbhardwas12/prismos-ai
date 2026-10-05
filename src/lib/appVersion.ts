// The app version shown in the UI. Injected at build time from package.json
// (vite.config.ts), so the sidebar, title bar and settings can't drift from a release.
export const APP_VERSION: string = import.meta.env.VITE_PRISMOS_VERSION ?? "dev";
