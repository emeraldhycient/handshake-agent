"use client"

import { useEffect, useState } from "react"
import { useStore } from "zustand"
import { defaultChatStore } from "@/lib/store/chat-store"
import { useAuthStore } from "@/lib/store/auth-store"
import { useChatHistory } from "@/hooks/use-chat-history"
import { useOptionalRouter } from "@/hooks/use-optional-router"
import {
  buildConfirmFromQuote,
  buildConfirmFromSwap,
  buildTicketConfirm,
  chipLabel,
  actionPrompt,
} from "@/lib/chat/flow"
import { ChatHeader } from "./chat-header"
import { MobileTabbar } from "./mobile-tabbar"
import { WalletTab } from "./wallet-tab"
import { ActivityTab } from "./activity-tab"
import { SettingsPanel } from "@/components/settings/settings-panel"
import { ChatThread } from "@/components/chat/chat-thread"
import { ChatComposer } from "@/components/chat/chat-composer"
import { ConfirmSheet } from "@/components/chat/overlays/confirm-sheet"
import { PinPad } from "@/components/chat/overlays/pin-pad"
import { SuccessOverlay } from "@/components/chat/overlays/success-overlay"
import { FocusTrap } from "@/components/shared/focus-trap"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import type { MobileShellProps, MobileTabId } from "@/types/components"
import type { ChatMessage, TicketOption, ChatAction } from "@/lib/schemas"

export function MobileShell({ store: injectedStore }: MobileShellProps) {
  const store = injectedStore ?? defaultChatStore
  const state = useStore(store)
  const authStatus = useAuthStore((s) => s.status)
  const router = useOptionalRouter()
  // Rehydrate the thread from server history on mount (authenticated only).
  useChatHistory("m", store)
  const [tab, setTab] = useState<MobileTabId>("chat")
  const recorder = useVoiceRecorder()

  // Finding #4: inject the dead-session redirect once on mount. The store can't
  // import next/navigation, so a 401 mid-flow (authorize/execute) routes the user
  // to re-auth via this handler. Re-runs only if the store or router changes.
  useEffect(() => {
    store.getState().setSessionExpiredHandler(() => router?.push("/login"))
  }, [store, router])

  function handleConfirm(message: ChatMessage) {
    if (message.kind === "swap") {
      // Live swap proposal — build confirm from the typed swap fields.
      state.openConfirm("m", buildConfirmFromSwap(message))
      return
    }
    if (message.kind !== "quote") return
    // Build the confirm sheet from the live quote so it shows the real
    // itemized breakdown (buy / sell / send).
    state.openConfirm("m", buildConfirmFromQuote(message))
  }

  function handleSelectTicket(opt: TicketOption) {
    state.openConfirm("m", buildTicketConfirm(opt.tier, opt.price, opt.total))
  }

  // Finding #1: when authenticated, a quick action must reach the REAL agent
  // with an amount-free open prompt (so the agent quotes against the user's real
  // balance/rate/limits) — never the hardcoded "Buy ₦50,000 of USDT" demo label.
  // This handler previously ALWAYS ran the mock `send`, even when signed in
  // (the critical bug). `label` is the caller's display label, used only for the
  // offline demo bubble.
  function handleQuickAction(action: ChatAction, label: string) {
    setTab("chat")
    if (authStatus === "authenticated") {
      void state.sendToAgent("m", actionPrompt(action))
    } else {
      state.send("m", label, action)
    }
  }

  const showConfirm = state.confirmOpen && state.overlaySurface === "m"
  const showPin = state.pinOpen && state.overlaySurface === "m"
  const showSuccess = state.successOpen && state.successSurface === "m"

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      <main
        id="main-content"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {tab === "chat" && (
          <>
            <ChatHeader />
            <ChatThread
              messages={state.threads.m}
              typing={state.typing.m}
              density="mobile"
              onConfirm={handleConfirm}
              onSelectTicket={handleSelectTicket}
              onResolveBeneficiary={(id, messageId) =>
                void state.resolveBeneficiary("m", id, messageId)
              }
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
              recording={recorder.status === "recording"}
              recordSeconds={recorder.seconds}
              canRecord={recorder.status !== "unsupported"}
              onRecordStart={() => void recorder.start()}
              onRecordStop={async () => {
                const blob = await recorder.stop()
                if (blob) void state.sendVoiceToAgent("m", blob)
              }}
              onRecordCancel={() => recorder.cancel()}
            />
          </>
        )}

        {tab === "wallet" && <WalletTab onQuickAction={handleQuickAction} />}
        {tab === "activity" && <ActivityTab />}
        {tab === "settings" && <SettingsPanel density="mobile" />}
      </main>

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
