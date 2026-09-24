import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Tauri watches Rust sources itself; its build artifacts can be locked on Windows.
      ignored: ['**/src-tauri/**'],
    },
  },
  resolve: {
    alias: { '@': '/src' },
  },
  optimizeDeps: {
    include: ['spark-md5', 'fflate'],
  },
})
