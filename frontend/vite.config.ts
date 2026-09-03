import { defineConfig } from 'vite'
import vueJsx from '@vitejs/plugin-vue-jsx'

export default defineConfig({
  plugins: [vueJsx()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
