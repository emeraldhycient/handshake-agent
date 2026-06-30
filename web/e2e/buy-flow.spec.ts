import { test, expect } from "@playwright/test"

/**
 * Buy flow E2E smokes — Phase 18.
 *
 * Both tests exercise the same money path through the real browser DOM:
 *   chip → quote (29.97 USDT) → "Review & confirm" → "Confirm with PIN"
 *   → PIN digits 1-2-3-4 → "Purchase complete"
 *
 * The default chat store uses the mock gateway (no real API calls) so
 * these tests run offline/in CI with no credentials required.
 *
 * Note on the store scheduler: the real store uses `setTimeout(fn, 680)` to
 * simulate an agent "typing" delay before the quote appears. Playwright's
 * default assertion timeout is 5 000 ms — well above 680 ms — so
 * `toBeVisible()` waits long enough without any explicit `waitForTimeout`.
 */

// ─── Mobile (route /app) ──────────────────────────────────────────────────────

test("mobile: buy flow — chip → quote → confirm → PIN → success", async ({
  page,
}) => {
  await page.goto("/app")

  // Tap the amount-free "Buy USDT" chip in the composer chips row.
  await page.getByRole("button", { name: "Buy USDT" }).click()

  // The store dispatches action "buy" → 680 ms later the agent replies with
  // a quote message containing "29.97 USDT". Wait for it.
  await expect(page.getByText("29.97 USDT")).toBeVisible({ timeout: 5_000 })

  // QuoteCard renders a native <button> (not a role=button with shadcn) with
  // text "Review & confirm". Click it to open the ConfirmSheet.
  await page.getByRole("button", { name: "Review & confirm" }).click()

  // ConfirmSheet (bottom Sheet on mobile) contains the "Confirm with PIN" CTA.
  await page
    .getByRole("button", { name: "Confirm with PIN" })
    .click({ timeout: 3_000 })

  // PinPad is now visible. Press digits 1, 2, 3, 4 in sequence.
  // Each digit is a ghost Button whose text is the digit itself.
  for (const digit of ["1", "2", "3", "4"]) {
    await page.getByRole("button", { name: digit, exact: true }).click()
  }

  // On the 4th digit, pinComplete() fires synchronously from pressPin() and
  // sets successOpen → true, revealing the SuccessOverlay (data-testid="success").
  // We scope to the overlay rather than getByText("Purchase complete") bare, because
  // the receipt card appended to the thread also contains that text — strict mode
  // would reject the ambiguous locator.
  await expect(
    page.getByTestId("success").getByText("Purchase complete")
  ).toBeVisible({ timeout: 3_000 })
})

// ─── Desktop (route /dashboard) ──────────────────────────────────────────────

test("desktop: buy flow — hero Buy button → quote → confirm → PIN → success", async ({
  page,
}) => {
  await page.goto("/dashboard")

  // The OverviewPage balance hero renders four action buttons: Buy, Send,
  // Receive, Swap. "Buy" is `aria-label="Buy"` on a native <button>.
  // Clicking it calls onQuickAction("buy", "Buy") → store.send("d", "Buy", "buy").
  await page.getByRole("button", { name: "Buy", exact: true }).click()

  // The chat rail (surface "d") receives the "buy" intent and — after 680 ms —
  // renders the quote with "29.97 USDT".
  await expect(page.getByText("29.97 USDT")).toBeVisible({ timeout: 5_000 })

  // QuoteCard "Review & confirm" CTA (same button text as mobile, desktop density).
  await page.getByRole("button", { name: "Review & confirm" }).click()

  // ConfirmSheet renders as a Dialog on desktop. The CTA text is "Confirm with PIN".
  await page
    .getByRole("button", { name: "Confirm with PIN" })
    .click({ timeout: 3_000 })

  // PinPad renders in desktop card mode; digits are the same ghost Buttons.
  for (const digit of ["1", "2", "3", "4"]) {
    await page.getByRole("button", { name: digit, exact: true }).click()
  }

  // SuccessOverlay (data-testid="success"): "Purchase complete".
  // Scoped to the overlay to avoid strict-mode collision with the receipt card
  // which also renders "Purchase complete" in the chat thread.
  await expect(
    page.getByTestId("success").getByText("Purchase complete")
  ).toBeVisible({ timeout: 3_000 })
})
