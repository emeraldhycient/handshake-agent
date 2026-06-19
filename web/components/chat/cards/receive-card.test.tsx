import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { ReceiveCard } from "./receive-card"
import type { ReceiveCardProps } from "@/types/components"

const baseProps: ReceiveCardProps = {
  kind: "receive",
  asset: "USDT",
  network: "TRON · TRC-20",
  address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
  minDeposit: "1 USDT",
  creditedEta: "~1 min",
  density: "mobile",
}

describe("ReceiveCard", () => {
  it("renders the address text for mobile density", () => {
    render(<ReceiveCard {...baseProps} density="mobile" />)
    expect(
      screen.getByText("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE")
    ).toBeInTheDocument()
  })

  it("renders the address text for desktop density", () => {
    render(<ReceiveCard {...baseProps} density="desktop" />)
    expect(
      screen.getByText("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE")
    ).toBeInTheDocument()
  })

  it("renders the network label for mobile density", () => {
    render(<ReceiveCard {...baseProps} density="mobile" />)
    expect(screen.getByText("TRON · TRC-20")).toBeInTheDocument()
  })

  it("renders the network label for desktop density", () => {
    render(<ReceiveCard {...baseProps} density="desktop" />)
    // desktop prototype combines asset+network in header (line 853)
    expect(screen.getByText(/TRON/)).toBeInTheDocument()
  })

  it("renders a Copy button with aria-label for mobile density", () => {
    render(<ReceiveCard {...baseProps} density="mobile" />)
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument()
  })

  it("renders a Copy button with aria-label for desktop density", () => {
    render(<ReceiveCard {...baseProps} density="desktop" />)
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument()
  })

  it("renders the QR placeholder for mobile density", () => {
    render(<ReceiveCard {...baseProps} density="mobile" />)
    expect(screen.getByTestId("qr")).toBeInTheDocument()
  })

  it("renders the QR placeholder for desktop density", () => {
    render(<ReceiveCard {...baseProps} density="desktop" />)
    expect(screen.getByTestId("qr")).toBeInTheDocument()
  })
})
