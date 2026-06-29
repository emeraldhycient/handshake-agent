"use client"

import { useState } from "react"
import { useStore } from "zustand"
import { defaultChatStore } from "@/lib/store/chat-store"
import { useAuthStore } from "@/lib/store/auth-store"
import { useChatHistory } from "@/hooks/use-chat-history"
import {
  buildConfirmForQuote,
  buildTicketConfirm,
  chipLabel,
} from "@/lib/chat/flow"
import { ChatHeader } from "./chat-header"
import { MobileTabbar } from "./mobile-tabbar"
import { WalletTab } from "./wallet-tab"
import { ActivityTab } from "./activity-tab"
import { ChatThread } from "@/components/chat/chat-thread"
import { ChatComposer } from "@/components/chat/chat-composer"
import { ConfirmSheet } from "@/components/chat/overlays/confirm-sheet"
import { PinPad } from "@/components/chat/overlays/pin-pad"
import { SuccessOverlay } from "@/components/chat/overlays/success-overlay"
import { FocusTrap } from "@/components/shared/focus-trap"
import type { MobileShellProps, MobileTabId } from "@/types/components"
import type { ChatMessage, TicketOption, ChatAction } from "@/lib/schemas"

export function MobileShell({ store: injectedStore }: MobileShellProps) {
  const store = injectedStore ?? defaultChatStore
  const state = useStore(store)
  const authStatus = useAuthStore((s) => s.status)
  // Rehydrate the thread from server history on mount (authenticated only).
  useChatHistory("m", store)
  const [tab, setTab] = useState<MobileTabId>("chat")

  function handleConfirm(message: ChatMessage) {
    if (message.kind !== "quote") return
    // message.action is "buy" | "send" | "swap" | "ticket" | "balance" | "receive"
    // after the kind === "quote" guard, only buy/send/swap are valid quote actions.
    const payload = buildConfirmForQuote(
      message.action as "buy" | "send" | "swap"
    )
    state.openConfirm("m", payload)
  }

  function handleSelectTicket(opt: TicketOption) {
    state.openConfirm("m", buildTicketConfirm(opt.tier, opt.price, opt.total))
  }

  function handleQuickAction(action: ChatAction, label: string) {
    setTab("chat")
    state.send("m", label, action)
  }

  const showConfirm = state.confirmOpen && state.overlaySurface === "m"
  const showPin = state.pinOpen && state.overlaySurface === "m"
  const showSuccess = state.successOpen && state.successSurface === "m"

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      {tab === "chat" && (
        <>
          <ChatHeader />
          <ChatThread
            messages={state.threads.m}
            typing={state.typing.m}
            density="mobile"
            onConfirm={handleConfirm}
            onSelectTicket={handleSelectTicket}
          />
          <ChatComposer
            chips={state.chips.m}
            value={state.input.m}
            onChange={(v) => state.setInput("m", v)}
            onSubmit={() => {
              if (authStatus === "authenticated") {
                void state.sendToAgent("m", state.input.m)
              } else {
                state.send("m", state.input.m)
              }
              state.setInput("m", "")
            }}
            onChip={(a) => {
              const label = chipLabel(a)
              if (authStatus === "authenticated") {
                void state.sendToAgent("m", label)
              } else {
                state.send("m", label, a)
              }
            }}
            density="mobile"
          />
        </>
      )}

      {tab === "wallet" && <WalletTab onQuickAction={handleQuickAction} />}
      {tab === "activity" && <ActivityTab />}

      <MobileTabbar active={tab} onSelect={setTab} />

      <ConfirmSheet
        open={showConfirm}
        payload={state.pending}
        density="mobile"
        onConfirm={() => void state.confirmToPin()}
        onCancel={state.cancel}
      />

      {showPin && (
        <FocusTrap ariaLabel="Enter your PIN">
          <PinPad
            open
            pinLength={state.pin.length}
            density="mobile"
            onDigit={state.pressPin}
            onBack={state.pinBack}
            onFaceId={() => void state.pinComplete()}
            onCancel={state.cancel}
            errorText={state.pinError ?? undefined}
          />
        </FocusTrap>
      )}

      <SuccessOverlay open={showSuccess} text={state.successText} />
    </div>
  )
}
