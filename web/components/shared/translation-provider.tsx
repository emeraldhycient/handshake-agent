"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"
import GoogleTranslate from "next-google-translate-widget"
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  findLanguage,
  type Language,
} from "@/lib/i18n/languages"
import { detectBrowserLanguage } from "@/lib/i18n/browser-language"
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

// Resolve the initial language synchronously (stored choice wins; else
// browser detection) so the first render already reflects it — no
// setState-in-effect cascade (react-hooks/set-state-in-effect).
function resolveInitialLanguage(): {
  language: Language
  stored: string | null
} {
  const stored = getActiveLanguageCode()
  const detected = detectBrowserLanguage(
    typeof navigator !== "undefined" ? (navigator.languages ?? []) : []
  )
  const code = stored ?? detected
  return { language: findLanguage(code) ?? DEFAULT_LANGUAGE, stored }
}

export function TranslationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [language, setLanguageState] = useState<Language>(
    () => resolveInitialLanguage().language
  )
  const initialised = useRef(false)

  // One-time: install the DOM-safety patch, and persist the resolved language
  // so Google's engine reads the cookie when its async script initialises —
  // no reload needed on first paint. The language itself is already resolved
  // in the lazy `useState` initializer above (kept out of this effect).
  useEffect(() => {
    if (initialised.current) return
    initialised.current = true

    installReactSafetyPatch()

    const { language: resolved, stored } = resolveInitialLanguage()
    if (resolved.code !== DEFAULT_LANGUAGE_CODE && !stored) {
      // Persist so the engine auto-applies on init; no live reload on mount.
      setActiveLanguageCode(resolved.code)
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
