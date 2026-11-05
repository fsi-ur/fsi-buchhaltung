import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^~\//, replacement: root },
      { find: /^@\//, replacement: root },
    ],
  },
  test: {
    name: 'db',
    environment: 'node',
    globals: true,
    include: ['tests/db/**/*.spec.ts'],
    setupFiles: ['tests/setup/db-env.ts'],
    globalSetup: ['tests/setup/global-db.ts'],
    // One worker, files one after another: the suites share one test database (Vitest 4 dropped
    // poolOptions.forks.singleFork).
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
