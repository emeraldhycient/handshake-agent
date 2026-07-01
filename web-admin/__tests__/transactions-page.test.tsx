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
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { TransactionsPage } from "@/components/admin/transactions-page"
import { TransactionDetail } from "@/components/admin/transaction-detail"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

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
})
