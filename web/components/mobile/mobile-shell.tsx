"use client"

import { useState } from "react"
import { useStore } from "zustand"
import { defaultChatStore } from "@/lib/store/chat-store"
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
  const state = useStore(injectedStore ?? defaultChatStore)
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
            onSubmit={() => state.send("m", state.input.m)}
            onChip={(a) => state.send("m", chipLabel(a), a)}
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
        onConfirm={state.confirmToPin}
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
            onFaceId={state.pinComplete}
            onCancel={state.cancel}
          />
        </FocusTrap>
      )}

      <SuccessOverlay open={showSuccess} text={state.successText} />
    </div>
  )
}
