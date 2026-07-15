import { create } from "zustand"

/** How long a settings toast stays up before auto-dismissing (design: 2.6s). */
export const TOAST_DURATION_MS = 2600

interface ToastState {
  message: string | null
  /** Show a transient toast; replaces any current one and restarts the timer. */
  show: (message: string) => void
  clear: () => void
}

let clearTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Client-only transient toast state for settings feedback (copied / revoked /
 * language set / logout). UI-only — never a server cache (root §5).
 */
export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    if (clearTimer) clearTimeout(clearTimer)
    set({ message })
    clearTimer = setTimeout(() => set({ message: null }), TOAST_DURATION_MS)
  },
  clear: () => {
    if (clearTimer) clearTimeout(clearTimer)
    set({ message: null })
  },
}))
