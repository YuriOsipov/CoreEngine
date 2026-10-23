import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { PrimeVueResolver } from '@openvue/auto-import-resolver'
import { fileURLToPath, URL } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const editorPackageRoot = fileURLToPath(new URL('../editor', import.meta.url))
const docEngineRoot = fileURLToPath(new URL('../docEngine', import.meta.url))

export default defineConfig({
  plugins: [
    tailwindcss(),
    vue(),
    Components({
      resolvers: [PrimeVueResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@docengine/field-date': fileURLToPath(
        new URL('../docEngine/packages/field-date/dist/index.js', import.meta.url),
      ),
    },
    // Linked local package — always resolve to source, not a stale prebundle.
    dedupe: ['@docengine/editor'],
  },
  optimizeDeps: {
    exclude: ['@docengine/editor'],
  },
  server: {
    fs: {
      allow: [projectRoot, editorPackageRoot, docEngineRoot],
    },
    // Backend / tooling edits must not full-reload the Vite UI.
    watch: {
      ignored: [
        '**/crm-bff/**',
        '**/.cursor/**',
        '**/supabase/**',
        '**/scripts/**',
        '**/agent-tools/**',
      ],
    },
  },
})
