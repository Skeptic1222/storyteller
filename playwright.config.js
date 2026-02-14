import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: ['**/*.spec.js'],
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  reporter: 'list',
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL || undefined,
    trace: 'on-first-retry'
  }
});
