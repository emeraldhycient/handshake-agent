"use client"

import { useTranslation } from "@/components/shared/translation-provider"
import { findLanguage } from "@/lib/i18n/languages"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { SectionCard, SettingRow } from "./section-card"
import type { SettingsSectionProps } from "@/types"

export function PreferencesSection({ density }: SettingsSectionProps) {
  const { language, languages, setLanguage } = useTranslation()
  const { showToast } = useToast()
  const mobile = density === "mobile"

  function handleChange(code: string) {
    setLanguage(code)
    const name = findLanguage(code)?.nativeName ?? code
    showToast(`Language set to ${name}`)
  }

  return (
    <SectionCard label="Preferences" density={density}>
      <SettingRow
        first
        density={density}
        icon={<GlobeIcon />}
        title="Language"
        subtitle={
          mobile
            ? "Amounts and addresses are never translated."
            : "Translated automatically. Amounts and addresses are never translated."
        }
        trailing={
          <div className={cn("relative flex-none", mobile && "ml-auto")}>
            <select
              value={language.code}
              onChange={(e) => handleChange(e.target.value)}
              aria-label="Language"
              className={cn(
                "cursor-pointer appearance-none rounded-[11px] border border-settings-btn-border bg-card-muted font-semibold text-settings-ink",
                mobile
                  ? "py-2 pr-8 pl-3 text-[13px]"
                  : "py-[9px] pr-[34px] pl-[13px] text-[13.5px]"
              )}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName}
                </option>
              ))}
            </select>
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              className={cn(
                "pointer-events-none absolute top-1/2 -translate-y-1/2 text-settings-label",
                mobile ? "right-[11px]" : "right-3"
              )}
            >
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </div>
        }
      />
    </SectionCard>
  )
}

function GlobeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className="text-primary"
    >
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M2.6 9h12.8M9 2.5c1.9 1.9 1.9 11.1 0 13M9 2.5c-1.9 1.9-1.9 11.1 0 13"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}
