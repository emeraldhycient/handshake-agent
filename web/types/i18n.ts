/** Prop/context types for the multi-language surface (`components/shared/`). */

import type { Language } from "@/lib/i18n/languages"

// ─── Multi-language (TranslationProvider) ────────────────────────────────────
export interface TranslationContextValue {
  language: Language
  languages: readonly Language[]
  setLanguage: (code: string) => void
  resetLanguage: () => void
}

export interface LanguageSelectorProps {
  className?: string
}
