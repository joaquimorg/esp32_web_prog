import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The production site lives under /esp32/ (https://home.joaquim.org/esp32/).
// Override with BASE_PATH=/ when deploying at the root of a domain.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.BASE_PATH || '/esp32/') : '/',
  plugins: [vue()]
}))
