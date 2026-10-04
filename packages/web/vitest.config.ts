import { defineConfig } from 'vitest/config';

// The app's pure modules (reducer, Ask) run under plain vitest: no bindings involved.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
