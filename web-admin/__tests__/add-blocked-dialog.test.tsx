/**
 * AddBlockedDialog test — the denylist value-capture dialog. The happy path (open →
 * fill → POST) is covered end-to-end by blocked-page.test.tsx; here we lock the two
 * branches that page test doesn't exercise: a duplicate is rejected inline before any
 * save, and a rejected save surfaces the server error on the value field. This dialog
 * owns no mutation — the parent's onSave persists the array through step-up.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { AddBlockedDialog } from "@/components/admin/add-blocked-dialog"
import { ApiError } from "@/lib/api/client"

let onSave: ReturnType<typeof vi.fn>
let onOpenChange: ReturnType<typeof vi.fn>

function renderDialog(denylist: string[]) {
  onSave = vi.fn()
  onOpenChange = vi.fn()
  render(
    <AddBlockedDialog
      open
      onOpenChange={onOpenChange as never}
      denylist={denylist}
      onSave={onSave as never}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("AddBlockedDialog", () => {
  it("rejects a duplicate inline without calling onSave", async () => {
    const user = userEvent.setup()
    renderDialog(["0xDEAD"])

    await user.type(screen.getByLabelText("Value"), "0xDEAD")
    await user.click(screen.getByRole("button", { name: "Add entry" }))

    expect(
      await screen.findByText("This entry is already on the blocked list")
    ).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("appends the trimmed value and closes on a successful save", async () => {
    onSave = vi.fn()
    onOpenChange = vi.fn()
    const saved = vi.fn().mockResolvedValue(undefined)
    render(
      <AddBlockedDialog
        open
        onOpenChange={onOpenChange as never}
        denylist={["0xAAA"]}
        onSave={saved as never}
      />
    )
    const user = userEvent.setup()

    await user.type(screen.getByLabelText("Value"), "  0xBBB  ")
    await user.click(screen.getByRole("button", { name: "Add entry" }))

    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(["0xAAA", "0xBBB"])
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("surfaces a rejected save on the value field", async () => {
    onSave = vi.fn()
    onOpenChange = vi.fn()
    const failing = vi
      .fn()
      .mockRejectedValue(new ApiError("Denylist locked.", 409, "CONFLICT"))
    render(
      <AddBlockedDialog
        open
        onOpenChange={onOpenChange as never}
        denylist={[]}
        onSave={failing as never}
      />
    )
    const user = userEvent.setup()

    await user.type(screen.getByLabelText("Value"), "0xNEW")
    await user.click(screen.getByRole("button", { name: "Add entry" }))

    expect(await screen.findByText("Denylist locked.")).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
