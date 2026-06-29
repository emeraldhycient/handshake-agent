import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ChatThread } from "./chat-thread"
import type { ChatMessage, TicketOption } from "@/lib/schemas"

const noop = () => {}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noopTicket = (_: TicketOption) => {}

const textMsg = (
  id: string,
  text: string,
  role: "user" | "assistant" = "assistant"
): ChatMessage => ({
  id,
  role,
  kind: "text",
  text,
})

describe("ChatThread", () => {
  it("renders the Today divider", () => {
    render(
      <ChatThread
        messages={[]}
        typing={false}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
        onResolveBeneficiary={() => {}}
      />
    )
    expect(screen.getByText("Today")).toBeInTheDocument()
  })

  it("renders one ChatMessageView per message", () => {
    const messages: ChatMessage[] = [
      textMsg("1", "Hello from user", "user"),
      textMsg("2", "Hello from assistant"),
      textMsg("3", "Second assistant message"),
    ]
    render(
      <ChatThread
        messages={messages}
        typing={false}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
        onResolveBeneficiary={() => {}}
      />
    )
    expect(screen.getByText("Hello from user")).toBeInTheDocument()
    expect(screen.getByText("Hello from assistant")).toBeInTheDocument()
    expect(screen.getByText("Second assistant message")).toBeInTheDocument()
  })

  it("shows TypingIndicator when typing=true", () => {
    render(
      <ChatThread
        messages={[]}
        typing={true}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
        onResolveBeneficiary={() => {}}
      />
    )
    expect(screen.getByTestId("typing")).toBeInTheDocument()
  })

  it("hides TypingIndicator when typing=false", () => {
    render(
      <ChatThread
        messages={[]}
        typing={false}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
        onResolveBeneficiary={() => {}}
      />
    )
    expect(screen.queryByTestId("typing")).not.toBeInTheDocument()
  })

  it("renders all message texts (count check)", () => {
    const messages: ChatMessage[] = Array.from({ length: 5 }, (_, i) =>
      textMsg(`${i}`, `Message ${i}`)
    )
    render(
      <ChatThread
        messages={messages}
        typing={false}
        density="mobile"
        onConfirm={noop}
        onSelectTicket={noopTicket}
        onResolveBeneficiary={() => {}}
      />
    )
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`Message ${i}`)).toBeInTheDocument()
    }
  })

  it("propagates onConfirm with the full message when quote card confirm is clicked", async () => {
    const onConfirm = vi.fn()
    const onSelectTicket = vi.fn()
    const quoteMsg: ChatMessage = {
      id: "q1",
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
      <ChatThread
        messages={[quoteMsg]}
        typing={false}
        density="mobile"
        onConfirm={onConfirm}
        onSelectTicket={onSelectTicket}
        onResolveBeneficiary={() => {}}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: /review & confirm/i })
    )
    expect(onConfirm).toHaveBeenCalledWith(quoteMsg)
  })
})
