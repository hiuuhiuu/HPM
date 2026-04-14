import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 설정.
 *
 * - 테스트는 현재 실행 중인 dev 서버(http://localhost:9700)를 사용
 * - 별도 webServer 기동 없음: 컨테이너가 이미 떠있다고 가정
 * - reporter는 list + html
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:9700',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
