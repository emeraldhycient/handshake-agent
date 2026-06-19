"use client"

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ConfirmSheet } from "./confirm-sheet"
import type { ConfirmPayload } from "@/lib/schemas"

const buyPayload: ConfirmPayload = {
  title: "Buy USDT",
  subtitle: "You will receive the following",
  heroLabel: "YOU RECEIVE",
  heroAmount: "29.97 USDT",
  heroSub: "≈ what lands in your wallet",
  rows: [
    { label: "You pay", value: "₦50,000.00" },
    { label: "Exchange rate", value: "₦1,671.38" },
  ],
  totalLabel: "Total to pay",
  totalValue: "₦50,000.00",
  cta: "Confirm with PIN",
  action: "buy",
}

const sendPayload: ConfirmPayload = {
  title: "Send USDT",
  subtitle: "Review before sending",
  heroLabel: "YOU SEND",
  heroAmount: "25.00 USDT",
  heroSub: "≈ ₦41,785 at current rate",
  toLabel: "To address",
  toValue: "TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ",
  warn: "Please double-check the address. Transactions are irreversible.",
  rows: [{ label: "Network fee", value: "1.00 USDT" }],
  totalLabel: "Total",
  totalValue: "26.00 USDT",
  cta: "Confirm with PIN",
  action: "send",
}

describe("ConfirmSheet — mobile density", () => {
  it("renders title, heroAmount, rows, and totalValue when open", () => {
    render(
      <ConfirmSheet
        open
        payload={buyPayload}
        density="mobile"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    // Title appears twice: once in sr-only SheetTitle and once in the visible body span
    expect(screen.getAllByText("Buy USDT").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("29.97 USDT")).toBeInTheDocument()
    expect(screen.getByText("You pay")).toBeInTheDocument()
    // ₦50,000.00 appears in both the row value and totalValue — getAllByText is correct
    expect(screen.getAllByText("₦50,000.00").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("Total to pay")).toBeInTheDocument()
    expect(screen.getByText("Confirm with PIN")).toBeInTheDocument()
  })

  it("renders warn text when payload has warn", () => {
    render(
      <ConfirmSheet
        open
        payload={sendPayload}
        density="mobile"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(
      screen.getByText(
        "Please double-check the address. Transactions are irreversible."
      )
    ).toBeInTheDocument()
  })

  it("calls onConfirm when cta is clicked", async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmSheet
        open
        payload={buyPayload}
        density="mobile"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: /confirm with pin/i })
    )
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("calls onCancel when Cancel button is clicked", async () => {
    const onCancel = vi.fn()
    render(
      <ConfirmSheet
        open
        payload={buyPayload}
        density="mobile"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("calls onCancel when Escape key is pressed", async () => {
    const onCancel = vi.fn()
    render(
      <ConfirmSheet
        open
        payload={buyPayload}
        density="mobile"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    )
    await userEvent.keyboard("{Escape}")
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("renders nothing when open is false", () => {
    const { container } = render(
      <ConfirmSheet
        open={false}
        payload={buyPayload}
        density="mobile"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(container.querySelector("[data-testid='confirm-body']")).toBeNull()
    expect(screen.queryByText("Buy USDT")).toBeNull()
  })

  it("renders nothing when payload is null", () => {
    render(
      <ConfirmSheet
        open
        payload={null}
        density="mobile"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.queryByText("Buy USDT")).toBeNull()
  })
})

describe("ConfirmSheet — desktop density", () => {
  it("renders the same body fields (title, heroAmount, rows, cta)", () => {
    render(
      <ConfirmSheet
        open
        payload={buyPayload}
        density="desktop"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    // Title appears twice: once in sr-only DialogTitle and once in the visible body span
    expect(screen.getAllByText("Buy USDT").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("29.97 USDT")).toBeInTheDocument()
    expect(screen.getByText("Confirm with PIN")).toBeInTheDocument()
  })

  it("renders warn text when payload has warn", () => {
    render(
      <ConfirmSheet
        open
        payload={sendPayload}
        density="desktop"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(
      screen.getByText(
        "Please double-check the address. Transactions are irreversible."
      )
    ).toBeInTheDocument()
  })

  it("calls onCancel when Cancel button is clicked", async () => {
    const onCancel = vi.fn()
    render(
      <ConfirmSheet
        open
        payload={buyPayload}
        density="desktop"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("calls onCancel when Escape key is pressed", async () => {
    const onCancel = vi.fn()
    render(
      <ConfirmSheet
        open
        payload={buyPayload}
        density="desktop"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    )
    await userEvent.keyboard("{Escape}")
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
