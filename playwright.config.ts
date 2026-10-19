import { defineConfig, devices } from "@playwright/test";

/**
 * Click-through UI tests against a real Quizy server.
 *   npm run test:ui                 # starts `next dev` on port 4100 with a throwaway database
 *   QUIZY_URL=http://127.0.0.1:3927 npm run test:ui   # test an already-running app instead
 * Uses the offline demo generator (MOCK_AI=1), so no AI model is needed.
 */
const external = process.env.QUIZY_URL;
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: external || "http://127.0.0.1:4100",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: external
    ? undefined
    : {
        command: "npx next dev -p 4100 -H 127.0.0.1",
        url: "http://127.0.0.1:4100/login",
        timeout: 180_000,
        reuseExistingServer: false,
        env: {
          DATABASE_URL: "file:./e2e-test.db",
          UPLOAD_DIR: "./data/e2e-uploads",
          MOCK_AI: "1",
          OPENAI_API_KEY: "",
          QUIZY_MODELS_DIR: "./data/e2e-models",
        },
      },
});
