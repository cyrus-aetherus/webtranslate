import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/unit/**/extractor.spec.js', 'jsdom'],
      ['tests/unit/**/batch-collector.spec.js', 'jsdom'],
    ],
    include: ['tests/unit/**/*.spec.js', 'tests/integration/**/*.spec.js'],
  },
});
