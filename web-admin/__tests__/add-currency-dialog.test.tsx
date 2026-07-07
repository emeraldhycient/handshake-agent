/**
 * AddCurrencyDialog test — the runtime custom-fiat registration form. The schema is
 * unit-tested in `lib/currencies/add-currency-schema.test.ts`; here we assert the composed
 * dialog: a valid submit calls `onSave` with the parsed (upper-cased) values, a duplicate
 * code is rejected inline (no `onSave`), and a validation error blocks submit. `onSave` is
 * a prop (the parent owns the step-up-gated write) — no api layer is involved.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { AddCurrencyDialog } from "@/components/admin/add-currency-dialog"

function renderDialog(
  onSave = vi.fn().mockResolvedValue(undefined),
  existingCodes: string[] = []
) {
  const onOpenChange = vi.fn()
  return {
    onSave,
    onOpenChange,
    ...render(
      <AddCurrencyDialog
        open
        onOpenChange={onOpenChange}
        existingCodes={existingCodes}
        onSave={onSave}
      />
    ),
  }
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  code = "ghs"
) {
  await user.type(screen.getByLabelText("Code"), code)
  await user.type(screen.getByLabelText("Symbol"), "C")
  await user.type(screen.getByLabelText("Display name"), "Ghanaian Cedi")
  const decimals = screen.getByLabelText("Rounding (decimal places)")
  await user.clear(decimals)
  await user.type(decimals, "2")
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("AddCurrencyDialog", () => {
  it("submits the parsed (upper-cased) values via onSave", async () => {
    const user = userEvent.setup()
    const { onSave } = renderDialog()
    await fillForm(user)

    await user.click(screen.getByRole("button", { name: "Add currency" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({
      code: "GHS",
      symbol: "C",
      displayName: "Ghanaian Cedi",
      decimals: 2,
    })
  })

  it("rejects a duplicate code inline without calling onSave", async () => {
    const user = userEvent.setup()
    const { onSave } = renderDialog(vi.fn(), ["GHS"])
    await fillForm(user, "ghs")

    await user.click(screen.getByRole("button", { name: "Add currency" }))

    expect(
      await screen.findByText(/GHS is already in the catalog/)
    ).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it("blocks submit and surfaces a validation error for a blank display name", async () => {
    const user = userEvent.setup()
    const { onSave } = renderDialog()
    await user.type(screen.getByLabelText("Code"), "ghs")
    await user.type(screen.getByLabelText("Symbol"), "C")
    // displayName left empty

    await user.click(screen.getByRole("button", { name: "Add currency" }))

    expect(await screen.findByText("Enter a display name")).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })
})
