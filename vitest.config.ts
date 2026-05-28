import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only discover tests under src/ — avoid picking up web/ or other packages
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/utils/**/*.ts'],
      exclude: ['src/utils/**/*.test.ts', 'src/utils/**/__tests__/**'],
    },
  },
});
