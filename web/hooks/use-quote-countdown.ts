"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Live countdown for a rate-locked quote/swap card. Driven by `expiresAt` (ISO
 * from the server) when present, falling back to `lockSeconds` (offline/mock
 * flow). Ticks every second; stops when there is no expiry source. Returns the
 * remaining whole seconds and whether it has expired.
 */
export function useQuoteCountdown(
  expiresAt: string | undefined,
  lockSeconds: number
): { remaining: number; isExpired: boolean } {
  function computeRemaining(): number {
    if (expiresAt) {
      return Math.max(
        0,
        Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)
      )
    }
    return Math.max(0, lockSeconds)
  }

  const [remaining, setRemaining] = useState<number>(computeRemaining)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!expiresAt && lockSeconds <= 0) return

    intervalRef.current = setInterval(() => {
      setRemaining(computeRemaining())
    }, 1000)

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt, lockSeconds])

  return { remaining, isExpired: remaining <= 0 }
}
