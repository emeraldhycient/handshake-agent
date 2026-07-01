/**
 * TransactionsPage + TransactionDetail render tests (design reproduction).
 *
 * Both screens were rebuilt as pixel-faithful reproductions of the design: they
 * render their own module-level mock content (no `@/lib/api/transactions`, no
 * `getMe`, no mark-failed mutation, no step-up-on-403). The list still filters its
 * mock rows by the design's view tabs (client-side) and its rows navigate to the
 * detail route; the detail screen renders a fixed representative transaction. The old
 * behavioural tests drove the api + step-up flows, which the reproduction no longer
 * has, so they are replaced with render tests over the reproduced design content.
 *
 * The list uses `useRouter().push` on row click, so `next/navigation` is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { TransactionsPage } from "@/components/admin/transactions-page"
import { TransactionDetail } from "@/components/admin/transaction-detail"
import { defaultToastStore } from "@/lib/store/toast-store"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

beforeEach(() => {
  push.mockClear()
  defaultToastStore.setState({ toasts: [] })
})

describe("TransactionsPage (design reproduction)", () => {
  it("renders the header, the ledger table columns and mock rows", () => {
    render(<TransactionsPage />)

    expect(
      screen.getByRole("heading", { name: "Transactions" })
    ).toBeInTheDocument()

    // The 7-column ledger table headers.
    expect(screen.getByText("ID")).toBeInTheDocument()
    expect(screen.getByText("Idempotency key")).toBeInTheDocument()

    // A known mock transaction id from the design's seed dataset (first page).
    expect(screen.getByText("tx_80231")).toBeInTheDocument()
  })

  it("renders the view tabs including Stuck / Pending", () => {
    render(<TransactionsPage />)

    expect(screen.getByRole("button", { name: /All/ })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Stuck \/ Pending/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Failed today/ })
    ).toBeInTheDocument()
  })

  it("copies the idempotency key + toasts and does NOT navigate the row", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn()
    // jsdom's navigator.clipboard is a getter-only prop — define it explicitly.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    render(<TransactionsPage />)

    // Each page row exposes its idem cell as a role="button" with a Copy
    // aria-label; take the first row's.
    const copyCell = screen.getAllByRole("button", {
      name: /Copy idempotency key idem_/i,
    })[0]
    const idem = copyCell.textContent ?? ""

    await user.click(copyCell)

    // Copies to the clipboard and emits the `Copied · …` toast (kind "copy").
    expect(writeText).toHaveBeenCalledWith(idem)
    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe(`Copied · ${idem}`)
    expect(toasts[0].kind).toBe("copy")

    // stopPropagation kept the row from navigating to the detail route.
    expect(push).not.toHaveBeenCalled()
  })
})

describe("TransactionDetail (design reproduction)", () => {
  it("renders the header, back-link and engine-brokered triage panels", () => {
    render(<TransactionDetail transactionId="tx_80283" />)

    // Back-link to the list + the copyable mock transaction id.
    expect(
      screen.getByRole("link", { name: /All transactions/ })
    ).toBeInTheDocument()
    expect(screen.getByText("tx_80283")).toBeInTheDocument()

    // The itemized-parameters + engine-state panels the design renders.
    expect(screen.getByText("Itemized parameters")).toBeInTheDocument()
    expect(screen.getByText("Engine state timeline")).toBeInTheDocument()

    // Engine-brokered triage actions (proposal only — never executes here).
    expect(
      screen.getByRole("button", { name: /Retry settlement/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Mark failed/ })
    ).toBeInTheDocument()
  })

  it("toasts (no flow) when Resend receipt is clicked", async () => {
    const user = userEvent.setup()
    render(<TransactionDetail transactionId="tx_80283" />)

    await user.click(screen.getByRole("button", { name: /Resend receipt/ }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].kind).toBe("info")
    expect(toasts[0].message).toMatch(/Receipt re-sent to the customer/)
  })

  it("deep-links Open ledger to this transaction", () => {
    render(<TransactionDetail transactionId="tx_80283" />)

    expect(screen.getByRole("link", { name: /Open ledger/ })).toHaveAttribute(
      "href",
      "/ledger?tx=tx_80283"
    )
  })
})
