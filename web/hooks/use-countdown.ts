import { useEffect, useState } from "react"

/**
 * Live countdown hook — ticks every second until the ISO `expiresAt` string
 * is reached or passed.
 *
 * Returns `{ secondsLeft: null, expired: false }` when no expiry is provided
 * (mock/offline flow has no server-issued expiry).
 * Returns `{ secondsLeft: 0, expired: true }` once the expiry has passed.
 *
 * The interval is cleaned up on unmount so there are no memory leaks.
 */
export function useCountdown(expiresAt?: string | null): {
  secondsLeft: number | null
  expired: boolean
} {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() => {
    if (!expiresAt) return null
    return Math.max(
      0,
      Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)
    )
  })

  useEffect(() => {
    if (!expiresAt) return

    function tick() {
      const remaining = Math.max(
        0,
        Math.round((new Date(expiresAt!).getTime() - Date.now()) / 1000)
      )
      setSecondsLeft(remaining)
    }

    tick() // sync immediately on mount / expiresAt change
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  if (secondsLeft === null) return { secondsLeft: null, expired: false }
  return { secondsLeft, expired: secondsLeft === 0 }
}
