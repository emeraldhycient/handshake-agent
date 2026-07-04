import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { authenticate } from "./support/auth"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]

/**
 * Snap every animation/transition to its settled end-state before scanning.
 *
 * The chat shells fade messages in via the `animate-hs-msg-in` entrance
 * animation, and also run infinite decorative loops (spark spin, typing blink)
 * that never "finish" — so waiting on `document.getAnimations()` is impossible.
 * Without this, axe races the entrance fade and reports the text at partial
 * opacity (e.g. foreground at ~45% → ≈3.2:1), a transient frame that is NOT a
 * WCAG 1.4.3 failure. Zeroing animation/transition durations forces the resting
 * visual state deterministically (what a `prefers-reduced-motion` user sees).
 * This removes only animation frames — every STATIC contrast failure is still
 * caught at full strictness.
 */
async function settleAnimations(page: Page) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`,
  })
}

/**
 * Scan a page and return its serious/critical WCAG violations — all rules, every
 * route. Color-contrast is enforced STRICT everywhere, including the authenticated
 * chat shells. The former exception that dropped `color-contrast` on those shells
 * (the `muted-foreground-subtle` token rendering ≈2.6–3.1:1 on the cream palette)
 * was removed once that token was darkened to meet AA — see the token definition
 * and rationale in web/app/globals.css.
 */
async function seriousViolations(page: Page) {
  await settleAnimations(page)
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      help: v.help,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    }))
}

// ── Public routes ────────────────────────────────────────────────────────────
for (const route of ["/login", "/signup", "/download", "/offline"]) {
  test(`a11y (public) ${route}: no serious/critical WCAG violations`, async ({
    page,
  }) => {
    await page.goto(route)
    const violations = await seriousViolations(page)
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })
}

// ── Authenticated app surfaces ───────────────────────────────────────────────
test("a11y (authed) /dashboard: no serious/critical WCAG violations", async ({
  page,
}) => {
  await authenticate(page)
  await page.goto("/dashboard")
  await expect(
    page.getByRole("button", { name: /notifications/i })
  ).toBeVisible({ timeout: 15_000 })
  const violations = await seriousViolations(page)
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
})

test("a11y (authed) /app: no serious/critical WCAG violations", async ({
  page,
}) => {
  await authenticate(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/app")
  await expect(page.getByRole("button", { name: /install app/i })).toBeVisible({
    timeout: 15_000,
  })
  const violations = await seriousViolations(page)
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
})
