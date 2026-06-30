import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const API_BASE = process.env.VITE_API_BASE ?? 'http://localhost:8090'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_BASE,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
  // Tauri needs a fixed port during dev
  clearScreen: false,
})
