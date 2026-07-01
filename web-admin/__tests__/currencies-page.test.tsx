/**
 * CurrenciesPage — certification that an approved Live toggle actually flips.
 *
 * The design binds each row's Live pill to `onToggle`, opening the shared
 * MakerCheckerModal (enabling / disabling a currency is a dual-control config
 * change). This asserts the full loop: clicking the pill opens the modal,
 * submitting for approval inverts the row's Live/Off state in place and toasts
 * the effective new state. Nothing moves money (§3.1) — it is a config flag.
 */
import { describe, expect, it, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { CurrenciesPage } from "@/components/admin/currencies-page"
import { defaultToastStore } from "@/lib/store/toast-store"

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("CurrenciesPage", () => {
  it("flips a currency's Live pill and toasts after maker-checker approval", async () => {
    const user = userEvent.setup()
    render(<CurrenciesPage />)

    // RWF starts Off (design seed) — its pill offers to Enable it.
    const enable = screen.getByRole("button", { name: /Enable RWF/i })
    expect(enable).toHaveTextContent(/Off/)

    // Clicking opens the dual-control modal; approve the change.
    await user.click(enable)
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    // The pill has flipped to Live (label + aria offer to Disable now).
    const disable = screen.getByRole("button", { name: /Disable RWF/i })
    expect(disable).toHaveTextContent(/Live/)

    // And a toast confirms the effective new state.
    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/RWF/)
    expect(toasts[0].message).toMatch(/Live/)
  })
})
