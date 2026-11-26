import { existsSync } from 'node:fs'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { PrimeVueResolver } from '@openvue/auto-import-resolver'
import { fileURLToPath, URL } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const editorPackageRoot = fileURLToPath(new URL('../editor', import.meta.url))
const docEngineRoot = fileURLToPath(new URL('../docEngine', import.meta.url))
const siblingEditorPkg = fileURLToPath(
  new URL('../docEngine/packages/editor', import.meta.url),
)
const siblingEnginePkg = fileURLToPath(
  new URL('../docEngine/packages/engine', import.meta.url),
)
const siblingFieldDate = fileURLToPath(
  new URL('../docEngine/packages/field-date/dist/index.js', import.meta.url),
)
const siblingEditorEntry = fileURLToPath(
  new URL('../docEngine/packages/editor/lib/index.js', import.meta.url),
)
const siblingEngineEntry = fileURLToPath(
  new URL('../docEngine/packages/engine/dist/index.js', import.meta.url),
)
const siblingEditorStyles = fileURLToPath(
  new URL('../docEngine/packages/editor/src/styles/editor.css', import.meta.url),
)
const siblingEditorBridge = fileURLToPath(
  new URL('../docEngine/packages/editor/src/themes/bridge.css', import.meta.url),
)
const siblingEditorPrime = fileURLToPath(
  new URL('../docEngine/packages/editor/src/themes/prime.css', import.meta.url),
)
const siblingEditorSlds = fileURLToPath(
  new URL('../docEngine/packages/editor/src/themes/slds.css', import.meta.url),
)
const hasSiblingDocEngine = existsSync(siblingFieldDate)
const hasSiblingEditor =
  existsSync(siblingEditorEntry) && existsSync(siblingEditorPrime)
const hasSiblingEngine = existsSync(siblingEngineEntry)

const siblingDocEngineAliases: Array<{ find: string | RegExp; replacement: string }> = []
if (hasSiblingDocEngine) {
  siblingDocEngineAliases.push({
    find: '@docengine/field-date',
    replacement: siblingFieldDate,
  })
}
if (hasSiblingEngine) {
  siblingDocEngineAliases.push({
    find: /^@docengine\/engine$/,
    replacement: siblingEngineEntry,
  })
}
if (hasSiblingEditor) {
  // Map package exports explicitly (aliasing only the root entry breaks subpaths).
  siblingDocEngineAliases.push(
    { find: '@docengine/editor/styles.css', replacement: siblingEditorStyles },
    { find: '@docengine/editor/themes/bridge.css', replacement: siblingEditorBridge },
    { find: '@docengine/editor/themes/prime.css', replacement: siblingEditorPrime },
    { find: '@docengine/editor/themes/slds.css', replacement: siblingEditorSlds },
    {
      find: '@docengine/editor/ui/field-form-modal',
      replacement: fileURLToPath(
        new URL('../docEngine/packages/editor/lib/ui/field-form-modal.js', import.meta.url),
      ),
    },
    {
      find: '@docengine/editor/ui/wire-modal-palette',
      replacement: fileURLToPath(
        new URL('../docEngine/packages/editor/lib/ui/wire-modal-palette.js', import.meta.url),
      ),
    },
    {
      find: '@docengine/editor/node',
      replacement: fileURLToPath(
        new URL('../docEngine/packages/editor/lib/node.js', import.meta.url),
      ),
    },
    {
      find: '@docengine/editor/dist',
      replacement: fileURLToPath(
        new URL('../docEngine/packages/editor/dist/editor.js', import.meta.url),
      ),
    },
    { find: /^@docengine\/editor$/, replacement: siblingEditorEntry },
  )
}

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
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      ...siblingDocEngineAliases,
    ],
    dedupe: ['@docengine/editor', '@docengine/engine'],
  },
  optimizeDeps: {
    exclude: ['@docengine/editor', '@docengine/engine'],
  },
  server: {
    fs: {
      allow: [
        projectRoot,
        ...(existsSync(editorPackageRoot) ? [editorPackageRoot] : []),
        ...(existsSync(docEngineRoot) ? [docEngineRoot] : []),
        ...(existsSync(siblingEditorPkg) ? [siblingEditorPkg] : []),
        ...(existsSync(siblingEnginePkg) ? [siblingEnginePkg] : []),
      ],
    },
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
