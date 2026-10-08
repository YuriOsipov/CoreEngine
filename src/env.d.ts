/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_DIRECTUS_URL: string
  readonly VITE_DIRECTUS_TOKEN?: string
  /** `bff` = session JWT via crm-bff. `none` disables login. Legacy `directus` is treated like `none`. */
  readonly VITE_AUTH_MODE?: 'bff' | 'none' | 'directus'
  /** Canonical: `graphql`. Legacy aliases `legacy` / `directus` disable GraphQL bridges. */
  readonly VITE_DATA_SOURCE?: 'graphql' | 'legacy' | 'directus'
  readonly VITE_RECORDS_SOURCE?: 'graphql' | 'legacy' | 'directus'
  readonly VITE_REGISTRY_SOURCE?: 'graphql' | 'rest' | 'legacy' | 'directus'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_GRAPHQL_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
