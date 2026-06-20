"use client"

import { useSyncExternalStore } from "react"

const DESKTOP_QUERY = "(min-width: 1024px)" // Tailwind lg

function subscribe(callback: () => void): () => void {
  const mq = window.matchMedia(DESKTOP_QUERY)
  mq.addEventListener("change", callback)
  return () => mq.removeEventListener("change", callback)
}

function getSnapshot(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches
}

// During SSR there is no window — always return null (no hydration mismatch).
function getServerSnapshot(): null {
  return null
}

/**
 * Returns null on the server / first paint (SSR-safe — no hydration mismatch),
 * then true on lg+ screens (≥1024px), false below. Updates reactively on resize.
 *
 * Uses useSyncExternalStore so React can track the external matchMedia state
 * without triggering cascading renders via setState-in-effect.
 */
export function useIsDesktop(): boolean | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
