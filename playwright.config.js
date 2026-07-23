const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['frontend.spec.js', 'auth-history.spec.js'],
  timeout: 20_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    env: {
      PORT: '4173',
      DEEPSEEK_API_KEY: 'test-only',
      DATABASE_PATH: ':memory:',
      SESSION_SECRET: 'playwright-session-secret-with-at-least-forty-eight-bytes',
      SESSION_COOKIE_SECURE: 'false',
      SESSION_MAX_AGE_MS: '604800000',
    },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
