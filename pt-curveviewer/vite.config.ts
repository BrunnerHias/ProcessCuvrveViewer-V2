import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',  // Portable: relative paths so index.html works from any folder
  build: {
    modulePreload: false, // No module preload polyfill — we inline everything
    rollupOptions: {
      output: {
        format: 'iife',              // Classic function scope — no module syntax
        inlineDynamicImports: true,   // Single chunk
      },
      plugins: [
        {
          // Handle import.meta.url in IIFE format (used by ECharts internals)
          name: 'resolve-import-meta',
          resolveImportMeta(property) {
            if (property === 'url') return 'document.baseURI';
            if (property === null) return '({url:document.baseURI})';
            return null;
          },
        },
      ],
    },
  },
})
