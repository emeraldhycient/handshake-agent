import { test, expect } from "@playwright/test"
import { authenticate } from "./support/auth"

/**
 * Language selection e2e — Task 12.
 *
 * Proves the real behavioural seam: choosing a non-English language in the
 * desktop Settings → Language combobox writes the `googtrans` cookie
 * (`/en/<code>`) and that choice survives a full page reload.
 *
 * The Google Translate widget script is stubbed to an empty response so the
 * suite never depends on the real translate.google.com network — this means
 * `.goog-te-combo` never renders, so `applyLanguageToLivePage` (see
 * lib/i18n/google-translate.ts) takes its "no combo yet" branch: it writes the
 * cookie FIRST, then calls `window.location.reload()`. That ordering is
 * exactly what this spec asserts.
 */
test.beforeEach(async ({ page }) => {
  // Stub every host the widget might pull its script/config from so CI never
  // hits the real network, regardless of which one it resolves to.
  const emptyScript = {
    status: 200,
    contentType: "application/javascript",
    body: "",
  }
  await page.route("**/translate.google.com/**", (route) =>
    route.fulfill(emptyScript)
  )
  await page.route("**/translate.googleapis.com/**", (route) =>
    route.fulfill(emptyScript)
  )
  await page.route("**/www.gstatic.com/**/translate*", (route) =>
    route.fulfill(emptyScript)
  )

  // Reach the authenticated desktop dashboard (existing e2e auth-stub pattern
  // — see buy-flow.spec.ts / a11y.spec.ts). Also stub the read endpoints the
  // dashboard chrome fetches on mount so nothing falls through to the real
  // backend the local dev server is configured against (web/.env.local points
  // NEXT_PUBLIC_API_BASE_URL at http://localhost:3001). The Settings panel and
  // sidebar tier badge render their error branch gracefully if these are
  // missing, but stubbing keeps the run deterministic and offline.
  await authenticate(page)

  await page.route("**/api/profile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        email: "amara@example.com",
        fullName: "Amara Okeke",
        phone: null,
        kycStatus: "verified",
        kycTier: "tier_1",
        fiatCurrency: "NGN",
        limits: null,
      }),
    })
  )

  await page.route("**/api/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fiats: [
          { code: "NGN", displayName: "Naira", symbol: "₦", decimals: 2 },
        ],
        assets: [],
        networks: [],
        capabilities: {},
      }),
    })
  )

  await page.route("**/api/notifications", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    })
  )
})

test("selecting a language writes the googtrans cookie and persists across reload", async ({
  page,
}) => {
  await page.goto("/dashboard")

  // Sidebar nav → Settings page (state-driven, not a route).
  await page
    .getByRole("navigation", { name: "Dashboard navigation" })
    .getByRole("button", { name: "Settings" })
    .click()

  // Language combobox (LanguageSelector): role="combobox", aria-label="Language".
  const combo = page.getByRole("combobox", { name: "Language" })
  await combo.click()
  await combo.fill("Fran")
  await page.getByRole("option", { name: /French/i }).click()

  // Cookie is written synchronously, before the reload the missing-combo
  // branch triggers (widget script is stubbed, so .goog-te-combo never exists).
  const cookies = await page.context().cookies()
  const googtrans = cookies.find((c) => c.name === "googtrans")
  expect(googtrans?.value).toContain("/en/fr")

  // Persistence: survives a full reload.
  await page.reload()
  const after = (await page.context().cookies()).find(
    (c) => c.name === "googtrans"
  )
  expect(after?.value).toContain("/en/fr")
})
