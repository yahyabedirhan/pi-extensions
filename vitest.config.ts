import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['extensions/**/*.test.ts'],
  },
  resolve: {
    // The tests copied from claude-mods import their runner from `claude-code/testing`.
    alias: { 'claude-code/testing': 'vitest' },
  },
})
