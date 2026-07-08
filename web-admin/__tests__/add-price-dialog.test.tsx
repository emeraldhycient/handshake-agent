/**
 * AddPriceDialog test — the base-rate value-capture dialog. The schema (coercion +
 * messages) is unit-tested in lib/pricing/add-price-schema.test.ts; here we assert the
 * composed dialog: the currency list narrows to the chosen asset, a valid submit hands
 * the coerced triple up via onContinue + closes, and validation blocks an empty submit.
 * This dialog owns no mutation — the parent runs the reason → step-up → maker-checker chain.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { AddPriceDialog } from "@/components/admin/add-price-dialog"
import type { AddPriceOption } from "@/types/components"

const OPTIONS: AddPriceOption[] = [
  { asset: "USDT", code: "NGN" },
  { asset: "USDT", code: "GHS" },
  { asset: "USDC", code: "KES" },
]

let onContinue: ReturnType<typeof vi.fn>
let onOpenChange: ReturnType<typeof vi.fn>

function renderDialog() {
  onContinue = vi.fn()
  onOpenChange = vi.fn()
  render(
    <AddPriceDialog
      open
      onOpenChange={onOpenChange as never}
      options={OPTIONS}
      onContinue={onContinue as never}
    />
  )
}

beforeEach(() => {
  renderDialog()
})

describe("AddPriceDialog", () => {
  it("narrows the currency list to the chosen asset", async () => {
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText("Asset"), "USDT")

    const currency = screen.getByLabelText("Currency")
    const codes = within(currency)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean)
    expect(codes).toEqual(["NGN", "GHS"])
  })

  it("hands the coerced (asset, currency, rate) up and closes on submit", async () => {
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText("Asset"), "USDT")
    await user.selectOptions(screen.getByLabelText("Currency"), "NGN")
    await user.type(screen.getByLabelText(/Base rate/), "1500")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(onContinue).toHaveBeenCalledWith({
      asset: "USDT",
      code: "NGN",
      rate: 1500,
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("blocks an empty submit with inline errors and no onContinue", async () => {
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(await screen.findByText("Select an asset")).toBeInTheDocument()
    expect(onContinue).not.toHaveBeenCalled()
  })
})
