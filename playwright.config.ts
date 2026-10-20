import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const DATA_DIR = join(tmpdir(), 'marble-e2e-data');

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:12174' },
  webServer: [
    { command: 'node e2e/mock-twitch.ts', url: 'http://localhost:12175/', reuseExistingServer: false },
    {
      command: `rm -rf ${DATA_DIR} && npm run build:web && node src/main.ts`,
      url: 'http://localhost:12174/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test', READER: 'fake', INSECURE_COOKIES: '1', PORT: '12174', PUBLIC_URL: 'http://localhost:12174',
        SESSION_SECRET: 'e2e-session-secret-0123456789-abcdefghij', DATA_DIR,
        TWITCH_CLIENT_ID: 'x', TWITCH_CLIENT_SECRET: 'y', TWITCH_AUTH_BASE: 'http://localhost:12175', TWITCH_HELIX_BASE: 'http://localhost:12175/helix',
        ADMIN_TWITCH_USER_ID: '1000', NTFY_BASE_URL: 'https://ntfy.example.test',
      },
    },
  ],
});
