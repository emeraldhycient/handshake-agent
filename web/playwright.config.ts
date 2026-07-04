import { defineConfig, devices } from "@playwright/test"

// Port/base URL are env-overridable so the suite can run against an already-
// running dev server (e.g. a preview on another port). CI keeps the 3000 default.
const PORT = process.env.E2E_PORT ?? "3000"
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
