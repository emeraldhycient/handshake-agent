"use client"

import { useStore } from "zustand"
import { defaultChatStore } from "@/lib/store/chat-store"
import { useAuthStore } from "@/lib/store/auth-store"
import { useChatHistory } from "@/hooks/use-chat-history"
import {
  buildConfirmFromQuote,
  buildTicketConfirm,
  chipLabel,
} from "@/lib/chat/flow"
import { ChatThread } from "@/components/chat/chat-thread"
import { ChatComposer } from "@/components/chat/chat-composer"
import { ConfirmSheet } from "@/components/chat/overlays/confirm-sheet"
import { PinPad } from "@/components/chat/overlays/pin-pad"
import { SuccessOverlay } from "@/components/chat/overlays/success-overlay"
import { FocusTrap } from "@/components/shared/focus-trap"
import { BrandMark } from "@/components/shared"
import { cn } from "@/lib/utils"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import type { ChatRailProps } from "@/types/components"
import type { ChatMessage, TicketOption } from "@/lib/schemas"

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Desktop chat rail — right-hand panel that drives the chat on surface "d".
 * Port of prototype lines 807–905 (incl. overlays 910–975).
 *
 * Mirrors MobileShell's store-wiring pattern:
 *  - Reads/writes surface "d" from the shared chat store.
 *  - Overlays are surface-guarded: they only open when overlaySurface === "d".
 *  - FocusTrap wraps PinPad (shared component, aria-label "Enter your PIN").
 *  - buildConfirmForQuote / buildTicketConfirm from @/lib/chat/flow — not
 *    re-implemented here.
 *
 * Optional `store` prop allows tests to inject a synchronous store
 * (no real setTimeout delays). Defaults to the module singleton.
 */
export function ChatRail({ store: injectedStore, className }: ChatRailProps) {
  const store = injectedStore ?? defaultChatStore
  const state = useStore(store)
  const authStatus = useAuthStore((s) => s.status)
  // Rehydrate the thread from server history on mount (authenticated only).
  useChatHistory("d", store)
  const recorder = useVoiceRecorder()

  // ── Quote confirm ──────────────────────────────────────────────────────────
  function handleConfirm(message: ChatMessage) {
    if (message.kind !== "quote") return
    state.openConfirm("d", buildConfirmFromQuote(message))
  }

  // ── Ticket selection ───────────────────────────────────────────────────────
  function handleSelectTicket(opt: TicketOption) {
    state.openConfirm("d", buildTicketConfirm(opt.tier, opt.price, opt.total))
  }

  // ── Overlay surface guards ─────────────────────────────────────────────────
  const showConfirm = state.confirmOpen && state.overlaySurface === "d"
  const showPin = state.pinOpen && state.overlaySurface === "d"
  const showSuccess = state.successOpen && state.successSurface === "d"

  return (
    <aside
      className={cn(
        "relative flex w-[372px] flex-none flex-col border-l border-border bg-card-muted",
        className
      )}
    >
      {/* ── Agent header ──────────────────────────────────────────────────── */}
      <div className="flex flex-none items-center gap-[11px] border-b border-border px-5 py-[18px]">
        {/* Agent avatar with online dot */}
        <div className="relative h-9 w-9 flex-none">
          <BrandMark size={36} />
          {/* Online indicator */}
          <div className="absolute -right-0.5 -bottom-0.5 h-[11px] w-[11px] rounded-full border-2 border-card-muted bg-success-bright" />
        </div>
        <div>
          <p className="text-[14.5px] font-bold text-foreground">
            Handshake Agent
          </p>
          <p className="text-xs text-muted-foreground">
            Online · replies instantly
          </p>
        </div>
      </div>

      {/* ── Thread ────────────────────────────────────────────────────────── */}
      <ChatThread
        messages={state.threads.d}
        typing={state.typing.d}
        density="desktop"
        onConfirm={handleConfirm}
        onSelectTicket={handleSelectTicket}
        onResolveBeneficiary={(id) => void state.resolveBeneficiary("d", id)}
      />

      {/* ── Composer (chips + input) ───────────────────────────────────────── */}
      <ChatComposer
        chips={state.chips.d}
        value={state.input.d}
        onChange={(v) => state.setInput("d", v)}
        onSubmit={() => {
          if (authStatus === "authenticated") {
            void state.sendToAgent("d", state.input.d)
          } else {
            state.send("d", state.input.d)
          }
          state.setInput("d", "")
        }}
        onChip={(a) => {
          const label = chipLabel(a)
          if (authStatus === "authenticated") {
            void state.sendToAgent("d", label)
          } else {
            state.send("d", label, a)
          }
        }}
        density="desktop"
        recording={recorder.status === "recording"}
        recordSeconds={recorder.seconds}
        canRecord={recorder.status !== "unsupported"}
        onRecordStart={() => void recorder.start()}
        onRecordStop={async () => {
          const blob = await recorder.stop()
          if (blob) void state.sendVoiceToAgent("d", blob)
        }}
        onRecordCancel={() => recorder.cancel()}
      />

      {/* ── Confirm overlay (surface-guarded) ─────────────────────────────── */}
      <ConfirmSheet
        open={showConfirm}
        payload={state.pending}
        density="desktop"
        onConfirm={() => void state.confirmToPin()}
        onCancel={state.cancel}
      />

      {/* ── PIN overlay (surface-guarded, focus-trapped) ───────────────────── */}
      {showPin && (
        <FocusTrap ariaLabel="Enter your PIN">
          <PinPad
            open
            pinLength={state.pin.length}
            density="desktop"
            onDigit={state.pressPin}
            onBack={state.pinBack}
            onFaceId={() => void state.pinComplete()}
            onCancel={state.cancel}
            errorText={state.pinError ?? undefined}
          />
        </FocusTrap>
      )}

      {/* ── Success overlay (surface-guarded) ─────────────────────────────── */}
      <SuccessOverlay open={showSuccess} text={state.successText} />
    </aside>
  )
}
