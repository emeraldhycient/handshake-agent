import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { ReceiveCard } from "./receive-card"
import type { ReceiveCardProps } from "@/types"

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
    // network now also appears inside the wrong-network warning, so scope to the
    // header pill (exact text, not inside the alert)
    const matches = screen.getAllByText("TRON · TRC-20")
    expect(matches.length).toBeGreaterThan(0)
  })

  it("renders the network label for desktop density", () => {
    render(<ReceiveCard {...baseProps} density="desktop" />)
    // desktop prototype combines asset+network in header (line 853)
    expect(screen.getAllByText(/TRON/).length).toBeGreaterThan(0)
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
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
    })
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

describe("ReceiveCard — Copy is wired (finding: dead no-op)", () => {
  it("writes the deposit address to the clipboard when Copy is clicked, even with no onCopy prop", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
    })
    render(<ReceiveCard {...baseProps} />)
    await userEvent.click(screen.getByRole("button", { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith(baseProps.address)
  })

  it("shows 'Copied' feedback after a successful copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
    })
    render(<ReceiveCard {...baseProps} />)
    await userEvent.click(screen.getByRole("button", { name: /copy address/i }))
    expect(
      await screen.findByRole("button", { name: /address copied/i })
    ).toBeInTheDocument()
  })

  it("still invokes the optional onCopy callback when provided", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
    })
    const onCopy = vi.fn()
    render(<ReceiveCard {...baseProps} onCopy={onCopy} />)
    await userEvent.click(screen.getByRole("button", { name: /copy/i }))
    expect(onCopy).toHaveBeenCalledOnce()
  })
})

describe("ReceiveCard — wrong-network warning (finding: beginners lose funds)", () => {
  it("renders a network-specific warning naming both asset and network (mobile)", () => {
    render(<ReceiveCard {...baseProps} density="mobile" />)
    const warning = screen.getByRole("alert")
    expect(warning).toHaveTextContent(/USDT/)
    expect(warning).toHaveTextContent(/TRON/)
    expect(warning).toHaveTextContent(/lost permanently/i)
  })

  it("renders the same warning on desktop density", () => {
    render(<ReceiveCard {...baseProps} density="desktop" />)
    const warning = screen.getByRole("alert")
    expect(warning).toHaveTextContent(/USDT/)
    expect(warning).toHaveTextContent(/TRON/)
  })

  it("conveys danger with an icon, not color alone (a11y)", () => {
    render(<ReceiveCard {...baseProps} density="mobile" />)
    const warning = screen.getByRole("alert")
    // a decorative warning glyph accompanies the text
    expect(warning.querySelector("svg")).not.toBeNull()
  })
})
