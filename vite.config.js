import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
 
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
    host: true,
  },
  preview: {
    port: parseInt(process.env.PORT || '3000'),
    host: true,
  },
})
