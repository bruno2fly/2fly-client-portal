import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    modules: {
      // Optional: enable CSS modules if needed
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(fileURLToPath(new URL('.', import.meta.url)), 'index.html'),
        login: resolve(fileURLToPath(new URL('.', import.meta.url)), 'login.html'),
        agency: resolve(fileURLToPath(new URL('.', import.meta.url)), 'agency.html')
      }
    }
  }
})

