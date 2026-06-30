import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { SettlingCard } from "./settling-card"
import type { SettlingCardProps } from "@/types/components"

// SettlingCard's *Live variant pulls the polling hook + store; the pure card
// under test does not, but the module imports them at load time, so stub both.
vi.mock("@/lib/query/hooks", () => ({
  useTransactionStatus: () => ({ data: undefined }),
}))
vi.mock("@/lib/store/chat-store", () => ({
  useChatStore: () => () => {},
}))

const baseProps: SettlingCardProps = {
  kind: "settling",
  txType: "send",
  transactionId: "tttttttt-tttt-tttt-tttt-tttttttttttt",
  title: "Transfer processing",
  subtitle: "Broadcasting your transfer on-chain.",
  rows: [{ label: "Amount", value: "25 USDT" }],
  reference: "REF-OUT-1",
  status: "settling",
  density: "mobile",
}

/** The danger pill renders the danger tokens; the info/warn pills do not. */
function pill(label: string): HTMLElement {
  return screen.getByText(label)
}

describe("SettlingCard — failure tone (finding: FAILED renders danger-red)", () => {
  it("renders the 'Failed' pill with the danger token, never the info/neutral palette", () => {
    render(<SettlingCard {...baseProps} status="failed" />)
    const failedPill = pill("Failed")
    expect(failedPill).toHaveClass("text-danger")
    expect(failedPill).toHaveClass("bg-danger-muted")
    expect(failedPill).not.toHaveClass("text-info")
    expect(failedPill).not.toHaveClass("bg-info-muted")
  })

  it("keeps the in-flight 'Processing' pill on the warn (not danger) palette", () => {
    render(<SettlingCard {...baseProps} status="settling" />)
    const processing = pill("Processing")
    expect(processing).toHaveClass("text-warn")
    expect(processing).not.toHaveClass("text-danger")
  })

  it("keeps the completed pill on the success palette", () => {
    render(<SettlingCard {...baseProps} status="completed" />)
    const sent = pill("Sent")
    expect(sent).toHaveClass("text-success")
    expect(sent).not.toHaveClass("text-danger")
  })
})

describe("SettlingCard — swap txType (finding: swap settling shows swap copy)", () => {
  const swapProps: SettlingCardProps = {
    ...baseProps,
    // "swap" is being added to the SettlingView.txType contract enum (lib/schemas);
    // cast until that lands so this card-side test compiles independently.
    txType: "swap" as SettlingCardProps["txType"],
    title: "Swap processing",
    subtitle: "Swapping USDT → TRX…",
    reference: "swp_123",
  }

  it("uses a swap eyebrow, not the on-chain transfer eyebrow", () => {
    render(<SettlingCard {...swapProps} />)
    expect(screen.getByText("Swap")).toBeInTheDocument()
    expect(screen.queryByText("On-Chain Transfer")).not.toBeInTheDocument()
  })

  it("labels the reference row as a swap reference", () => {
    render(<SettlingCard {...swapProps} />)
    expect(screen.getByText("Swap reference")).toBeInTheDocument()
  })

  it("shows a swap-completed pill + copy on completion", () => {
    render(<SettlingCard {...swapProps} status="completed" />)
    expect(screen.getByText("Swapped")).toBeInTheDocument()
  })
})
