"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"
import GoogleTranslate from "next-google-translate-widget"
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  findLanguage,
  type Language,
} from "@/lib/i18n/languages"
import {
  detectBrowserLanguage,
  readNavigatorLanguages,
} from "@/lib/i18n/browser-language"
import {
  getActiveLanguageCode,
  setActiveLanguageCode,
} from "@/lib/i18n/translate-cookie"
import {
  installReactSafetyPatch,
  applyLanguageToLivePage,
  resetToOriginal,
} from "@/lib/i18n/google-translate"
import type { TranslationContextValue } from "@/types/components"

const DEFAULT_LANGUAGE =
  findLanguage(DEFAULT_LANGUAGE_CODE) ?? SUPPORTED_LANGUAGES[0]

const TranslationContext = createContext<TranslationContextValue | null>(null)

export function TranslationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  // SSR-safe two-pass: the initial render (server AND client hydration) must
  // always be the constant default, since cookie/navigator are unavailable
  // during SSR. The real (cookie/navigator-derived) language is resolved and
  // applied only after hydration, in the effect below, to avoid a mismatch.
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE)
  const initialised = useRef(false)

  // One-time, client-only: install the DOM-safety patch, resolve the real
  // language (stored choice wins; else browser detection), persist it so
  // Google's engine reads the cookie when its async script initialises (no
  // reload needed), and apply it to state now that hydration is done.
  useEffect(() => {
    if (initialised.current) return
    initialised.current = true

    installReactSafetyPatch()

    const stored = getActiveLanguageCode()
    const detected = detectBrowserLanguage(readNavigatorLanguages())
    const code = stored ?? detected
    const resolved = findLanguage(code) ?? DEFAULT_LANGUAGE

    if (resolved.code !== DEFAULT_LANGUAGE_CODE) {
      // Persist so the engine auto-applies on init; no live reload on mount.
      if (!stored) setActiveLanguageCode(resolved.code)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe two-pass hydration: initial render must equal the server's DEFAULT_LANGUAGE; the real (cookie/navigator-derived) language is applied only after hydration to avoid a mismatch.
      setLanguageState(resolved)
    }
  }, [])

  function setLanguage(code: string): void {
    const next = findLanguage(code) ?? DEFAULT_LANGUAGE
    setLanguageState(next)
    if (next.code === DEFAULT_LANGUAGE_CODE) {
      resetToOriginal()
      return
    }
    applyLanguageToLivePage(next.code)
  }

  function resetLanguage(): void {
    setLanguageState(DEFAULT_LANGUAGE)
    resetToOriginal()
  }

  return (
    <TranslationContext.Provider
      value={{
        language,
        languages: SUPPORTED_LANGUAGES,
        setLanguage,
        resetLanguage,
      }}
    >
      {/* Hidden engine: injects Google's script + combo. Kept out of the
          a11y tree and visually gone; our LanguageSelector is the control. */}
      <div aria-hidden className="sr-only" translate="no">
        <GoogleTranslate pageLanguage="en" />
      </div>
      {children}
    </TranslationContext.Provider>
  )
}

export function useTranslation(): TranslationContextValue {
  const ctx = useContext(TranslationContext)
  if (!ctx) {
    throw new Error("useTranslation must be used within a TranslationProvider")
  }
  return ctx
}
