import { cn } from "@/lib/utils"
import { QuoteCard } from "@/components/chat/cards/quote-card"
import { BalanceCard } from "@/components/chat/cards/balance-card"
import { ReceiveCard } from "@/components/chat/cards/receive-card"
import { TicketsCard } from "@/components/chat/cards/tickets-card"
import { ReceiptCard } from "@/components/chat/cards/receipt-card"
import { PayInCardLive } from "@/components/chat/cards/pay-in-card"
import { SettlingCardLive } from "@/components/chat/cards/settling-card"
import { NeedsBeneficiaryCard } from "@/components/chat/cards/needs-beneficiary-card"
import { TransactionsCard } from "@/components/chat/cards/transactions-card"
import { SwapCard } from "@/components/chat/cards/swap-card"
import type { ChatMessageViewProps } from "@/types/components"

/**
 * ChatMessageView — kind-dispatch wrapper for all chat message variants.
 * Handles alignment (user → right, assistant/cards → left) and entrance animation.
 * Pure component: no hooks, no effects, no "use client" directive.
 */
export function ChatMessageView({
  message,
  density,
  onConfirm,
  onSelectTicket,
  onResolveBeneficiary,
}: ChatMessageViewProps) {
  const isUser = message.kind === "text" && message.role === "user"

  return (
    <div
      className={cn(
        "flex animate-hs-msg-in",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {(() => {
        switch (message.kind) {
          case "text":
            return message.role === "user" ? (
              <p
                className={cn(
                  "max-w-[82%] rounded-[18px_18px_5px_18px] bg-primary px-[15px] py-[11px]",
                  "text-[14.5px] text-primary-foreground"
                )}
              >
                {message.text}
              </p>
            ) : (
              <p
                className={cn(
                  "max-w-[82%] rounded-[18px_18px_18px_5px] border border-border bg-card",
                  "px-[15px] py-[11px] text-[14.5px] text-foreground"
                )}
              >
                {message.text}
              </p>
            )

          case "quote":
            return (
              <QuoteCard
                {...message}
                density={density}
                onConfirm={() => onConfirm(message)}
              />
            )

          case "balance":
            return <BalanceCard {...message} density={density} />

          case "receive":
            return <ReceiveCard {...message} density={density} />

          case "tickets":
            return (
              <TicketsCard
                {...message}
                density={density}
                onSelect={onSelectTicket}
              />
            )

          case "receipt":
            return <ReceiptCard {...message} density={density} />

          case "pay_in":
            return <PayInCardLive {...message} density={density} />

          case "settling":
            return <SettlingCardLive {...message} density={density} />

          case "needs_beneficiary":
            return (
              <NeedsBeneficiaryCard
                {...message}
                density={density}
                onResolve={onResolveBeneficiary}
              />
            )
          case "transactions":
            return <TransactionsCard {...message} density={density} />

          case "swap":
            return (
              <SwapCard
                {...message}
                density={density}
                onConfirm={() => onConfirm(message)}
              />
            )

          default: {
            // Exhaustiveness check: TypeScript will error here if a new kind is
            // added to ChatMessage without a matching case above.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const _exhaustive: never = message
            return null
          }
        }
      })()}
    </div>
  )
}
