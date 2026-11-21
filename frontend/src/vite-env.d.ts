/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'demo' | 'api'
  readonly VITE_API_BASE_URL?: string
  /** 'true' builds only the landing page: no app, no CesiumJS, CTAs show "Coming soon". */
  readonly VITE_LANDING_ONLY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  CESIUM_BASE_URL: string
}
