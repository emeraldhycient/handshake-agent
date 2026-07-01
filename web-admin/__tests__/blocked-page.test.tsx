/**
 * BlockedPage test (design §6.7 reproduction).
 *
 * The screen is a design reproduction (no fetching). These tests assert the
 * reactive mock behaviour the design chains:
 *
 *  1. The seed rows + header render.
 *  2. Add → the purpose-built AddBlockedDialog collects a value, and on submit a
 *     new row is prepended to the table + an "ok" toast fires.
 *  3. Remove → the shared ReasonModal → StepUpModal chain deletes the row from the
 *     same useState list + an "ok" toast fires.
 */
import { describe, expect, it, beforeEach } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { BlockedPage } from "@/components/admin/blocked-page"
import { defaultToastStore } from "@/lib/store/toast-store"

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("BlockedPage (design reproduction)", () => {
  it("renders the header + a known seed row", () => {
    render(<BlockedPage />)

    expect(
      screen.getByRole("heading", { name: "Blocked list" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("TQmByr1s6dLPU9Xz8y7Gk2f4Nc3Vw5Hj8")
    ).toBeInTheDocument()
  })

  it("appends a new row via the add dialog and toasts on save", async () => {
    const user = userEvent.setup()
    render(<BlockedPage />)

    const newValue = "0xAbC1230000000000000000000000000000000009"
    expect(screen.queryByText(newValue)).not.toBeInTheDocument()

    // Open the purpose-built AddBlockedDialog (not the generic reason modal).
    await user.click(screen.getByRole("button", { name: "+ Add entry" }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Add to the blocked list")

    // Fill the value + submit.
    await user.type(within(dialog).getByLabelText("Value"), newValue)
    await user.click(within(dialog).getByRole("button", { name: "Add entry" }))

    // The row is prepended to the visible table.
    await waitFor(() => expect(screen.getByText(newValue)).toBeInTheDocument())
    // …and the dialog closed.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe(`Added to blocked list · ${newValue}`)
    expect(toasts[0].kind).toBe("ok")
  })

  it("removes a row via the reason → step-up chain and toasts", async () => {
    const user = userEvent.setup()
    render(<BlockedPage />)

    const target = "0114227781 · Access Bank"
    expect(screen.getByText(target)).toBeInTheDocument()

    // Open the Remove flow → ReasonModal.
    await user.click(
      screen.getByRole("button", {
        name: `Remove ${target} from the blocked list`,
      })
    )
    await user.type(screen.getByLabelText("Reason"), "Confirmed mule account")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    // StepUpModal — enter the 6-digit code via the keypad.
    for (const digit of ["1", "2", "3", "4", "5", "6"]) {
      await user.click(screen.getByRole("button", { name: digit }))
    }

    // The row is gone from the visible table + the removal toast fired.
    await waitFor(() =>
      expect(screen.queryByText(target)).not.toBeInTheDocument()
    )

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe(`Removed from blocked list · ${target}`)
    expect(toasts[0].kind).toBe("ok")
  })
})
