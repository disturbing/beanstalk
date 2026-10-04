import { defineConfig } from 'vitest/config';

// Pure modules (the race reducer, the Ask pipeline): no bindings involved.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
