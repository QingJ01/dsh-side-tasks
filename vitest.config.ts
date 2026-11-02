import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['packages/plugins/side-tasks/tests/setup.ts'],
    include: ['packages/plugins/side-tasks/tests/**/*.spec.ts', 'packages/plugins/side-tasks/tests/**/*.spec.tsx'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
