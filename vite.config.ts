import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  css: {
    modules: {
      // Optional: enable CSS modules if needed
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        login: './login.html',
        agency: './agency.html'
      }
    },
    // Ensure agency.js is copied to dist
    copyPublicDir: true
  }
})

