"use client"

import { useRef, useState, useEffect } from "react"
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
import type { MobileShellProps, MobileTabId } from "@/types/components"
import type { ChatMessage, TicketOption, ChatAction } from "@/lib/schemas"

// ─── Minimal focus trap — no radix-ui/internal dependency ────────────────────

const FOCUSABLE =
  'a[href],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"])'

/**
 * Wraps the PIN modal with a self-contained focus trap:
 *  - Focuses the wrapper div (or its first focusable descendant) on mount.
 *  - Intercepts Tab / Shift+Tab to cycle within the wrapper.
 *  - No Esc-dismiss (PIN confirmation must be explicit).
 */
function PinFocusTrap({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    // Focus the first focusable child, or the wrapper itself.
    const first = wrap.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? wrap).focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !wrap) return
      const focusable = Array.from(
        wrap.querySelectorAll<HTMLElement>(FOCUSABLE)
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    wrap.addEventListener("keydown", handleKeyDown)
    return () => wrap.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <div
      ref={wrapRef}
      role="dialog"
      aria-modal="true"
      aria-label="Enter your PIN"
      className="absolute inset-0 z-[45]"
      // tabIndex makes the wrapper itself focusable as a fallback
      tabIndex={-1}
    >
      {children}
    </div>
  )
}

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
        <PinFocusTrap>
          <PinPad
            open
            pinLength={state.pin.length}
            density="mobile"
            onDigit={state.pressPin}
            onBack={state.pinBack}
            onFaceId={state.pinComplete}
            onCancel={state.cancel}
          />
        </PinFocusTrap>
      )}

      <SuccessOverlay open={showSuccess} text={state.successText} />
    </div>
  )
}
