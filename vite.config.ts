import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
        main: './index.html',
        login: './login.html',
        agency: './agency.html'
      }
    }
  }
})

