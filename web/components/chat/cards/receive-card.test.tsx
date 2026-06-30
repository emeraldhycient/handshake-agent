import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { ReceiveCard } from "./receive-card"
import type { ReceiveCardProps } from "@/types/components"

// Capture the `value` prop passed to QRCodeSVG so we can assert it matches the address.
vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({
    value,
    ...rest
  }: {
    value: string
    [key: string]: unknown
  }) => <svg data-testid="qr" data-qr-value={value} role="img" {...rest} />,
}))

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

  it("calls onCopy when the Copy button is clicked", async () => {
    const onCopy = vi.fn()
    render(<ReceiveCard {...baseProps} onCopy={onCopy} />)
    await userEvent.click(screen.getByRole("button", { name: /copy/i }))
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it("QR component encodes the deposit address as its value (mobile)", () => {
    render(<ReceiveCard {...baseProps} density="mobile" />)
    const qr = screen.getByTestId("qr")
    expect(qr).toHaveAttribute("data-qr-value", baseProps.address)
  })

  it("QR component encodes the deposit address as its value (desktop)", () => {
    render(<ReceiveCard {...baseProps} density="desktop" />)
    const qr = screen.getByTestId("qr")
    expect(qr).toHaveAttribute("data-qr-value", baseProps.address)
  })

  it("does not render a placeholder QR pattern (real QR replaces fake)", () => {
    render(<ReceiveCard {...baseProps} density="mobile" />)
    // qr-module and qr-finder are placeholder-specific test IDs — they must be absent
    expect(screen.queryByTestId("qr-module")).not.toBeInTheDocument()
    expect(screen.queryByTestId("qr-finder")).not.toBeInTheDocument()
  })
})
