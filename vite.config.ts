import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      exclude: ['src/main.tsx', '**/*.test.*'],
    },
  },
})
