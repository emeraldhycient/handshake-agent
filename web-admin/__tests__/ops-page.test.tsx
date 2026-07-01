/**
 * OpsPage — certification of the per-job "Run now" flow feedback.
 *
 * The design binds each background job's "Run now" affordance to the shared
 * engine-brokered flow: reason (audit) → step-up (TOTP) → engine-action. This
 * asserts the final leg is live: executing via the engine enqueues a
 * "Run started · <job>" toast (the design's verify expects the queued
 * feedback), naming the job that was run. No live endpoint runs — it is
 * engine-brokered oversight (§3.1); no funds move.
 */
import { describe, expect, it, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { OpsPage } from "@/components/admin/ops-page"
import { defaultToastStore } from "@/lib/store/toast-store"

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("OpsPage", () => {
  it("toasts 'Run started' naming the job after the engine action executes", async () => {
    const user = userEvent.setup()
    render(<OpsPage />)

    // First background job in the design seed is "Reconciliation sweep".
    await user.click(
      screen.getByRole("button", { name: /Run Reconciliation sweep now/i })
    )

    // Reason (audit) leg — a reason is required to continue.
    await user.type(
      screen.getByLabelText("Reason"),
      "Manual reconciliation catch-up"
    )
    await user.click(screen.getByRole("button", { name: /Continue/ }))

    // Step-up (TOTP) leg — six digits auto-complete the code.
    for (let i = 0; i < 6; i += 1) {
      await user.click(screen.getByRole("button", { name: "1" }))
    }

    // Engine-action leg — trigger via engine.
    await user.click(screen.getByRole("button", { name: "Trigger via engine" }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/Run started/)
    expect(toasts[0].message).toMatch(/Reconciliation sweep/)
    expect(toasts[0].kind).toBe("info")
  })
})
