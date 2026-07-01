"use client"

/**
 * Toaster — renders the toast-store queue as the design's fixed bottom-right
 * stack (template.html "TOASTS" block). Each toast is a dark `--btn-dark`
 * surface with a status-coloured icon chip; the whole stack is a polite live
 * region so confirmations are announced without stealing focus.
 *
 * The 2600ms auto-dismiss timer (design `toast()` setTimeout) lives here, one
 * per toast, tied to the toast's mount lifecycle so it is always cleaned up.
 */
import { useEffect } from "react"

import {
  useToastStore,
  type Toast,
  type ToastKind,
} from "@/lib/store/toast-store"

// design: toast auto-dismiss window (logic.js `setTimeout(…, 2600)`).
const DISMISS_MS = 2600

// Kind → icon-chip background utility (design `bg` map: warn amber, info blue,
// else the bright-green "ok" accent; `copy` reuses ok).
const CHIP_BG: Record<ToastKind, string> = {
  ok: "bg-toast-ok",
  copy: "bg-toast-ok",
  info: "bg-tif",
  warn: "bg-brand-amber",
}

// Kind → chip glyph path (design `icons` map).
const CHIP_ICON: Record<ToastKind, string> = {
  ok: "M5 12l5 5L20 6",
  copy: "M9 9h10v10H9zM5 15V5h10",
  info: "M12 8h.01M11 12h1v4h1",
  warn: "M12 4l9 16H3zM12 10v4",
}

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss)

  // Schedule this toast's dismissal on mount; clear it if the toast unmounts
  // first (e.g. the queue was reset) so no stray timer fires.
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast.id, dismiss])

  return (
    <div className="pointer-events-auto flex max-w-[380px] animate-[hsToast_0.2s_ease] items-center gap-2.5 rounded-xl bg-btn-dark px-[15px] py-[11px] text-[13px] font-semibold text-white shadow-toast">
      <span
        aria-hidden="true"
        className={`flex size-5 flex-none items-center justify-center rounded-md text-toast-ink ${CHIP_BG[toast.kind]}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path
            d={CHIP_ICON[toast.kind]}
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>{toast.message}</span>
    </div>
  )
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-[22px] bottom-[22px] z-[200] flex flex-col items-end gap-[9px]"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
