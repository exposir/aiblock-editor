import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

export default defineConfig({
  base: './',
  define: {
    __AIBLOCK_CLI_VERSION__: JSON.stringify(packageVersion),
  },
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
