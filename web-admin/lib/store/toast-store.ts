/**
 * Zustand toast store — the operator console's ephemeral notification queue.
 *
 * Mirrors the design's `toast(msg, kind)` helper (logic.js): a lightweight,
 * non-blocking confirmation for read-shaped actions (export, test-connection,
 * copy, view-diff). It is UI-only client state — never a server cache (§5).
 *
 * Architecture (mirrors theme-store's dual export):
 * - `createToastStore` is the testable vanilla factory (no React); tests create
 *   isolated instances to avoid cross-test state pollution.
 * - `defaultToastStore` is the module-level singleton (vanilla StoreApi).
 * - `useToastStore` is the React hook bound to the singleton.
 *
 * The store stays pure + synchronous: it appends/removes toasts by id. The
 * auto-dismiss timer (design: 2600ms) lives in the Toaster component so the
 * store has no timers to leak and remains trivially testable.
 */

import { createStore } from "zustand/vanilla"
import { useStore } from "zustand"

// ─── State interface ────────────────────────────────────────────────────────────

/**
 * Toast kinds — the design's four (logic.js `icons` map). `copy` reuses the
 * "ok" green with a copy glyph; `warn`/`info` carry their own accent colour.
 */
export type ToastKind = "ok" | "info" | "warn" | "copy"

export interface Toast {
  id: number
  message: string
  kind: ToastKind
}

export interface ToastState {
  toasts: readonly Toast[]

  /**
   * Enqueue a toast. `kind` defaults to `"ok"` (design: `kind || 'ok'`).
   * Returns the new toast's id so a caller can schedule its dismissal.
   */
  push(message: string, kind?: ToastKind): number

  /** Remove the toast with `id` (no-op if it is already gone). */
  dismiss(id: number): void
}

// ─── Factory ─────────────────────────────────────────────────────────────────────

/**
 * Create a vanilla Zustand toast store.
 * Returns a `StoreApi<ToastState>` — use `.getState()` / `.subscribe()`.
 *
 * Ids are a monotonic per-store counter (never `Date.now()`), so ids stay
 * stable + unique regardless of wall-clock, which keeps React keys and tests
 * deterministic.
 */
export function createToastStore() {
  let nextId = 0
  return createStore<ToastState>()((set) => ({
    toasts: [],

    push(message, kind = "ok") {
      const id = (nextId += 1)
      set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }))
      return id
    },

    dismiss(id) {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    },
  }))
}

// ─── React singleton binding ──────────────────────────────────────────────────────

/** Module-level singleton vanilla store — the one queue the Toaster renders. */
export const defaultToastStore = createToastStore()

export type ToastStore = ReturnType<typeof createToastStore>

/**
 * Push a toast from anywhere (React or not) — the ergonomic entry point used by
 * screen click handlers. Delegates to the singleton store.
 */
export function pushToast(message: string, kind?: ToastKind): number {
  return defaultToastStore.getState().push(message, kind)
}

/**
 * React hook bound to the module-default singleton toast store.
 *
 * @example
 *   const toasts = useToastStore((s) => s.toasts)
 */
export function useToastStore(): ToastState
export function useToastStore<U>(selector: (state: ToastState) => U): U
export function useToastStore<U>(
  selector?: (state: ToastState) => U
): U | ToastState {
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStore(defaultToastStore, selector)
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStore(defaultToastStore)
}
