"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** The non-standard install event Chromium fires; we defer and re-fire it. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable"

export interface InstallPromptState {
  /** A native install prompt is available (Chromium captured beforeinstallprompt). */
  canPrompt: boolean
  /** The app is already installed / running standalone — hide install affordances. */
  isInstalled: boolean
  /** iOS Safari, where the event never fires and we must show A2HS instructions. */
  isIOS: boolean
  /** Trigger the native prompt (Chromium) — resolves 'unavailable' elsewhere. */
  promptInstall: () => Promise<InstallOutcome>
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false
  const mm = window.matchMedia?.("(display-mode: standalone)").matches ?? false
  // iOS Safari exposes standalone on navigator, not via display-mode.
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return mm || iosStandalone
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  const isIPhoneOrPad = /iphone|ipad|ipod/i.test(ua)
  // iPadOS 13+ masquerades as macOS — disambiguate by touch support.
  const isIPadDesktopUA = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1
  return isIPhoneOrPad || isIPadDesktopUA
}

/**
 * Drives the install affordance. Captures the deferred `beforeinstallprompt`
 * event on Chromium so we can trigger the native prompt from our own UI, tracks
 * whether the app is already installed (to hide the affordance), and flags iOS
 * Safari where only manual "Add to Home Screen" is possible.
 *
 * All environment reads happen in effects (never at init) so the first render
 * matches the server render — no hydration mismatch.
 */
export function useInstallPrompt(): InstallPromptState {
  const [canPrompt, setCanPrompt] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const deferred = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    // Environment (window/navigator) is read only after mount so the first
    // client render matches the anonymous server render — the canonical
    // hydration-safe pattern (see RequireAuth). These run exactly once.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe mount read
    setIsInstalled(detectStandalone())
    setIsIOS(detectIOS())

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault() // stop Chrome's mini-infobar; we prompt on demand
      deferred.current = event as BeforeInstallPromptEvent
      setCanPrompt(true)
    }
    function onInstalled() {
      deferred.current = null
      setCanPrompt(false)
      setIsInstalled(true)
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
    window.addEventListener("appinstalled", onInstalled)

    const mql = window.matchMedia?.("(display-mode: standalone)")
    const onDisplayChange = () => setIsInstalled(detectStandalone())
    mql?.addEventListener?.("change", onDisplayChange)

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt)
      window.removeEventListener("appinstalled", onInstalled)
      mql?.removeEventListener?.("change", onDisplayChange)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const event = deferred.current
    if (!event) return "unavailable"
    await event.prompt()
    const { outcome } = await event.userChoice
    // A deferred prompt is single-use — discard it whatever the user chose.
    deferred.current = null
    setCanPrompt(false)
    return outcome
  }, [])

  return { canPrompt, isInstalled, isIOS, promptInstall }
}
