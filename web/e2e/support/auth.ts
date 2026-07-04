import type { Page } from "@playwright/test"

/**
 * Stub the real auth endpoints and seed a persisted refresh token so a Playwright
 * page lands on the authenticated, KYC-verified app shell without a live backend.
 *
 * Flow this satisfies: the store rehydrates the refresh token from localStorage →
 * AuthProvider silently refreshes (stubbed) → fetches /me (stubbed, verified) →
 * RequireAuth + RequireVerified pass → the shell (and its chrome) renders.
 */
export async function authenticate(page: Page): Promise<void> {
  await page.route("**/api/auth/refresh", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accessToken: "e2e-access-token",
        refreshToken: "e2e-refresh-token",
      }),
    })
  )

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        userId: "11111111-1111-1111-1111-111111111111",
        email: "amara@example.com",
        kycStatus: "verified",
        kycTier: "tier_1",
        hasPin: true,
        firstName: "Amara",
        lastName: "Okeke",
      }),
    })
  )

  await page.addInitScript(() => {
    localStorage.setItem("ha.refreshToken", "e2e-refresh-token")
  })
}

/** Make the page report display-mode: standalone (i.e. installed as a PWA). */
export async function emulateInstalled(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = ((query: string) =>
      query.includes("standalone")
        ? {
            matches: true,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent() {
              return false
            },
          }
        : original(query)) as typeof window.matchMedia
  })
}
