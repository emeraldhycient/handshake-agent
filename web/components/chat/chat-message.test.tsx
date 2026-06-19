import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ChatMessageView } from "./chat-message"
import type { ChatMessage, TicketOption } from "@/lib/schemas"

const noop = () => {}
const noopTicket = (_: TicketOption) => {}

describe("ChatMessageView", () => {
  it("text user message renders right-aligned bubble", () => {
    const msg: ChatMessage = {
      id: "1",
      role: "user",
      kind: "text",
      text: "Hello",
    }
    const { container } = render(
      <ChatMessageView
        message={msg}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
      />
    )
    expect(screen.getByText("Hello")).toBeInTheDocument()
    // outer wrapper has justify-end for user messages
    expect(container.firstChild).toHaveClass("justify-end")
  })

  it("text assistant message renders left-aligned bubble", () => {
    const msg: ChatMessage = {
      id: "2",
      role: "assistant",
      kind: "text",
      text: "Hi there",
    }
    const { container } = render(
      <ChatMessageView
        message={msg}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
      />
    )
    expect(screen.getByText("Hi there")).toBeInTheDocument()
    expect(container.firstChild).toHaveClass("justify-start")
  })

  it("quote message renders QuoteCard (shows receiveAmt)", () => {
    const msg: ChatMessage = {
      id: "3",
      role: "assistant",
      kind: "quote",
      action: "buy",
      receiveAmt: "29.97 USDT",
      receiveSub: "≈ what lands in your wallet",
      rows: [{ label: "You pay", value: "₦50,000" }],
      totalLabel: "Total",
      totalValue: "₦50,000",
      lockSeconds: 60,
    }
    render(
      <ChatMessageView
        message={msg}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
      />
    )
    expect(screen.getByText("29.97 USDT")).toBeInTheDocument()
  })

  it("balance message renders BalanceCard (shows total)", () => {
    const msg: ChatMessage = {
      id: "4",
      role: "assistant",
      kind: "balance",
      total: "≈ ₦72,340",
      assets: [],
    }
    render(
      <ChatMessageView
        message={msg}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
      />
    )
    expect(screen.getByText("≈ ₦72,340")).toBeInTheDocument()
  })

  it("receive message renders ReceiveCard (shows address label)", () => {
    const msg: ChatMessage = {
      id: "5",
      role: "assistant",
      kind: "receive",
      asset: "USDT",
      network: "TRON",
      address: "TQn9Y2khEb7g5mZ8FjpRt1cWnH4d",
      minDeposit: "1 USDT",
      creditedEta: "~1 min",
    }
    render(
      <ChatMessageView
        message={msg}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
      />
    )
    // ReceiveCard renders "Deposit address" label
    expect(screen.getByText(/deposit address/i)).toBeInTheDocument()
  })

  it("tickets message renders TicketsCard (shows eventName)", () => {
    const msg: ChatMessage = {
      id: "6",
      role: "assistant",
      kind: "tickets",
      eventMeta: "Lagos · Sat 12 Jul",
      eventName: "Afrobeats Live",
      options: [
        {
          tier: "General",
          perk: "Entry only",
          price: "₦25,000",
          left: "142 left",
          total: "₦25,000",
        },
      ],
    }
    render(
      <ChatMessageView
        message={msg}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
      />
    )
    expect(screen.getByText("Afrobeats Live")).toBeInTheDocument()
  })

  it("receipt message renders ReceiptCard (shows txRef)", () => {
    const msg: ChatMessage = {
      id: "7",
      role: "assistant",
      kind: "receipt",
      title: "Purchase complete",
      subtitle: "USDT credited to your wallet",
      amount: "+ 29.97 USDT",
      rows: [],
      txRef: "HS-20240701-7X9K",
    }
    render(
      <ChatMessageView
        message={msg}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
      />
    )
    expect(screen.getByText("HS-20240701-7X9K")).toBeInTheDocument()
  })

  it("onConfirm is called when quote card confirm button is clicked", async () => {
    const onConfirm = vi.fn()
    const msg: ChatMessage = {
      id: "8",
      role: "assistant",
      kind: "quote",
      action: "buy",
      receiveAmt: "29.97 USDT",
      receiveSub: "≈ what lands in your wallet",
      rows: [{ label: "You pay", value: "₦50,000" }],
      totalLabel: "Total",
      totalValue: "₦50,000",
      lockSeconds: 60,
    }
    render(
      <ChatMessageView
        message={msg}
        density="mobile"
        onConfirm={onConfirm}
        onSelectTicket={noopTicket}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: /review & confirm/i })
    )
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
