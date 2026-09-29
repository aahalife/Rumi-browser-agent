import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/portal/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/portal/api': 'http://localhost:8000',
    },
  },
})
