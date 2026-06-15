import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/mobile/',
  plugins: [vue()],
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
