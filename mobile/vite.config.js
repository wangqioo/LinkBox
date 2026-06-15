import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const buildRevision = process.env.LINKBOX_BUILD_REV || Date.now().toString(36)

export default defineConfig({
  base: '/mobile/',
  plugins: [vue()],
  define: {
    __LINKBOX_BUILD_REV__: JSON.stringify(buildRevision),
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-${buildRevision}-[hash].js`,
        chunkFileNames: `assets/[name]-${buildRevision}-[hash].js`,
        assetFileNames: `assets/[name]-${buildRevision}-[hash][extname]`,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:3100',
        changeOrigin: true,
        headers: { 'X-Accel-Buffering': 'no' },
      },
    },
  },
})
