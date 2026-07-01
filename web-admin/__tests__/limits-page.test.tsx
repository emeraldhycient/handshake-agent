/**
 * LimitsPage test (design §6.26 reproduction).
 *
 * Editing an amount cap is maker-checker. The pencil opens a new-value prompt →
 * reason (audit) → step-up (TOTP) → maker-checker. The captured new value drives the
 * maker-checker from→to preview, and approving it ("Submit for approval") writes the
 * new value onto the edited row in local state — so the displayed cap changes and a
 * toast fires (the design's reactive mock state).
 */
import { beforeEach, describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { LimitsPage } from "@/components/admin/limits-page"
import { defaultToastStore } from "@/lib/store/toast-store"

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

/** Drive the shared flow chain: reason → step-up (6 digits) → maker-checker. */
async function advanceThroughAuditChain(
  user: ReturnType<typeof userEvent.setup>
) {
  // Reason step — a non-empty reason enables Continue.
  await user.type(
    screen.getByRole("textbox", { name: "Reason" }),
    "Ops correction"
  )
  await user.click(screen.getByRole("button", { name: "Continue" }))

  // Step-up — entering six digits auto-advances to the maker-checker step.
  for (const d of "123456") {
    await user.click(screen.getByRole("button", { name: d }))
  }
}

describe("LimitsPage (maker-checker amount-cap edit)", () => {
  it("renders the tier tabs and the seed amount caps", () => {
    render(<LimitsPage />)

    expect(
      screen.getByRole("heading", { name: "Limits & velocity" })
    ).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Tier 1" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    // "Weekly max" is a unique Tier-1 cap (₦1,000,000).
    expect(screen.getByText("₦1,000,000")).toBeInTheDocument()
  })

  it("captures a new value and shows it in the maker-checker from→to preview", async () => {
    const user = userEvent.setup()
    render(<LimitsPage />)

    await user.click(screen.getByRole("button", { name: "Edit Weekly max" }))

    // New-value prompt — replace the current cap.
    const input = screen.getByRole("textbox", { name: "New value" })
    await user.clear(input)
    await user.type(input, "₦1,500,000")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await advanceThroughAuditChain(user)

    const dialog = screen.getByRole("dialog", { name: "Update limit" })
    // The from→to preview shows the OLD value and the NEW captured value.
    expect(within(dialog).getByText("₦1,000,000")).toBeInTheDocument()
    expect(within(dialog).getByText("₦1,500,000")).toBeInTheDocument()
  })

  it("updates the displayed cap + toasts after the edit is approved", async () => {
    const user = userEvent.setup()
    render(<LimitsPage />)

    await user.click(screen.getByRole("button", { name: "Edit Weekly max" }))

    const input = screen.getByRole("textbox", { name: "New value" })
    await user.clear(input)
    await user.type(input, "₦1,500,000")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await advanceThroughAuditChain(user)

    await user.click(
      screen.getByRole("button", { name: "Submit for approval" })
    )

    // The row's displayed cap changed and the old value is gone.
    expect(screen.getByText("₦1,500,000")).toBeInTheDocument()
    expect(screen.queryByText("₦1,000,000")).not.toBeInTheDocument()

    // A feedback toast fired and the flow closed.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        message: "Weekly max · Tier 1 → ₦1,500,000",
      })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("refuses to continue from the new-value prompt when the field is empty", async () => {
    const user = userEvent.setup()
    render(<LimitsPage />)

    await user.click(screen.getByRole("button", { name: "Edit Weekly max" }))

    await user.clear(screen.getByRole("textbox", { name: "New value" }))
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled()
  })
})
