import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
 
export default defineConfig({
  plugins: [react()],
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.[jt]sx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 3000,
  },
  preview: {
    port: parseInt(process.env.PORT || '3000'),
    host: true,
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
    host: true,
  },
})
