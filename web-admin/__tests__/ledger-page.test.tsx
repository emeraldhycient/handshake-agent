/**
 * LedgerPage render test (design reproduction).
 *
 * LedgerPage was rebuilt as a pixel-faithful reproduction of the design's Ledger
 * screen: it renders its own module-level mock legs (no `@/lib/api/ledger`, no
 * verify mutation, no integrity-check-on-click). The old behavioural test drove a
 * `verifyLedger` api that the reproduction no longer calls, so it is replaced with a
 * render test asserting the reproduced design content: the heading, the
 * sequence-integrity pill, the table headers, and a known mock ledger row.
 */
import { describe, expect, it, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { LedgerPage } from "@/components/admin/ledger-page"
import { defaultToastStore } from "@/lib/store/toast-store"

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("LedgerPage (design reproduction)", () => {
  it("renders the header + the sequence-integrity pill", () => {
    render(<LedgerPage />)

    expect(screen.getByRole("heading", { name: "Ledger" })).toBeInTheDocument()
    expect(screen.getByText("Sequence integrity OK")).toBeInTheDocument()
  })

  it("renders the six-column table headers and a mock ledger row", () => {
    render(<LedgerPage />)

    // The six column headers of the double-entry viewer.
    expect(screen.getByText("Seq")).toBeInTheDocument()
    expect(screen.getByText("Account")).toBeInTheDocument()
    expect(screen.getByText("Running")).toBeInTheDocument()
    expect(screen.getByText("Source")).toBeInTheDocument()

    // A known mock leg from the design's BASE_LEGS (a user NGN account row) and its
    // transaction source, which links to the tx-detail route (several legs share the
    // tx_80231 source, so more than one link renders).
    expect(screen.getByText("user:usr_10480:NGN")).toBeInTheDocument()
    expect(
      screen.getAllByRole("link", { name: "tx_80231" }).length
    ).toBeGreaterThanOrEqual(1)
  })

  it("toasts the CSV export confirmation when Export is clicked", async () => {
    const user = userEvent.setup()
    render(<LedgerPage />)

    await user.click(screen.getByRole("button", { name: /Export/i }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe("Exporting ledger to CSV…")
    expect(toasts[0].kind).toBe("info")
  })
})
