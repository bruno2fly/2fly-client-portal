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
      // Dummy entry point - all HTML files are in public/ and will be copied as-is
      // This prevents Vite from processing the standalone HTML files
      main: './dummy-entry.js'
    },
    // Ensure public folder (including all standalone HTML files) is copied to dist
    copyPublicDir: true
  }
})

