import { test, expect } from "@playwright/test"
import { authenticate, emulateInstalled } from "./support/auth"

const SHOT_DIR = process.env.E2E_SHOT_DIR ?? "test-results"

test.describe("PWA install affordance", () => {
  test("public /download shows the QR + install guidance", async ({ page }) => {
    await page.goto("/download")
    await expect(
      page.getByRole("heading", { name: /install handshake agent/i })
    ).toBeVisible()
    await expect(
      page.getByRole("img", { name: /scan to install/i })
    ).toBeVisible()
    await page.screenshot({
      path: `${SHOT_DIR}/download-page.png`,
      fullPage: true,
    })
  })

  test("desktop chrome shows an install button that opens the modal", async ({
    page,
  }) => {
    await authenticate(page)
    await page.goto("/dashboard")

    const installBtn = page.getByRole("button", { name: /install app/i })
    await expect(installBtn).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: `${SHOT_DIR}/dashboard-install-button.png` })

    await installBtn.click()
    const dialog = page.getByRole("dialog", {
      name: /install handshake agent/i,
    })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("img", { name: /scan/i })).toBeVisible()
    // Let the open animation settle before capturing.
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOT_DIR}/install-modal.png` })
  })

  test("the beforeinstallprompt event surfaces the native install button", async ({
    page,
  }) => {
    await authenticate(page)
    await page.goto("/dashboard")
    await page.getByRole("button", { name: /install app/i }).click()

    // Simulate Chromium firing the deferred install prompt.
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt") as Event & {
        prompt: () => Promise<void>
        userChoice: Promise<{ outcome: string }>
      }
      e.prompt = () => Promise.resolve()
      e.userChoice = Promise.resolve({ outcome: "accepted" })
      window.dispatchEvent(e)
    })

    const dialog = page.getByRole("dialog", {
      name: /install handshake agent/i,
    })
    await expect(
      dialog.getByRole("button", { name: /^install app$/i })
    ).toBeVisible()
  })

  test("mobile chrome shows the install button in the chat header", async ({
    page,
  }) => {
    await authenticate(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/app")
    await expect(
      page.getByRole("button", { name: /install app/i })
    ).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: `${SHOT_DIR}/mobile-install-header.png` })
  })

  test("hides the install button once installed (standalone)", async ({
    page,
  }) => {
    await authenticate(page)
    await emulateInstalled(page)
    await page.goto("/dashboard")

    // The chrome renders (bell present) but the install affordance is gone.
    await expect(
      page.getByRole("button", { name: /notifications/i })
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole("button", { name: /install app/i })
    ).toHaveCount(0)
    await page.screenshot({ path: `${SHOT_DIR}/dashboard-installed.png` })
  })
})
