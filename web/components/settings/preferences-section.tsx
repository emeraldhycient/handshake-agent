"use client"

import { useProfile } from "@/lib/query/auth"
import { useConfig } from "@/lib/query/hooks"
import { useUpdateProfile } from "@/lib/query/profile"
import { useTranslation } from "@/components/shared/translation-provider"
import { findLanguage } from "@/lib/i18n/languages"
import { toErrorMessage } from "@/lib/error-message"
import { useToast } from "@/hooks/use-toast"
import { SectionCard, SettingRow, PillSelect } from "./section-card"
import type { SettingsSectionProps } from "@/types"

export function PreferencesSection({ density }: SettingsSectionProps) {
  const profile = useProfile()
  const config = useConfig()
  const updateProfile = useUpdateProfile()
  const { language, languages, setLanguage } = useTranslation()
  const { showToast } = useToast()

  const fiats = config.data?.fiats ?? []
  const currentFiat = profile.data?.fiatCurrency
  // Keep the current currency selectable even while /config loads (never hide it).
  const fiatOptions =
    currentFiat && !fiats.some((f) => f.code === currentFiat)
      ? [
          {
            code: currentFiat,
            displayName: currentFiat,
            symbol: "",
            decimals: 2,
          },
          ...fiats,
        ]
      : fiats

  function handleLanguage(code: string) {
    setLanguage(code)
    showToast(`Language set to ${findLanguage(code)?.nativeName ?? code}`)
  }

  async function handleCurrency(code: string) {
    if (!currentFiat || code === currentFiat) return
    try {
      await updateProfile.mutateAsync({ fiatCurrency: code })
      showToast(`Display currency set to ${code}`)
    } catch (err) {
      showToast(toErrorMessage(err) ?? "Could not change currency")
    }
  }

  return (
    <SectionCard label="Preferences" density={density}>
      {currentFiat && (
        <SettingRow
          first
          density={density}
          icon={<CurrencyIcon />}
          title="Display currency"
          subtitle="The currency your balances and amounts are shown in."
          trailing={
            <PillSelect
              density={density}
              ariaLabel="Display currency"
              value={currentFiat}
              onChange={handleCurrency}
              options={fiatOptions.map((f) => ({
                value: f.code,
                label: f.symbol ? `${f.code} · ${f.symbol}` : f.code,
              }))}
            />
          }
        />
      )}
      <SettingRow
        first={!currentFiat}
        density={density}
        icon={<GlobeIcon />}
        title="Language"
        subtitle={
          density === "mobile"
            ? "Amounts and addresses are never translated."
            : "Translated automatically. Amounts and addresses are never translated."
        }
        trailing={
          <PillSelect
            density={density}
            ariaLabel="Language"
            value={language.code}
            onChange={handleLanguage}
            options={languages.map((l) => ({
              value: l.code,
              label: l.nativeName,
            }))}
          />
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

function CurrencyIcon() {
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
        d="M11 6.6c-.5-.7-1.2-1.1-2-1.1-1.3 0-2.3.9-2.3 2s1 2 2.3 2 2.3.9 2.3 2-1 2-2.3 2c-.8 0-1.5-.4-2-1.1M9 4.3v9.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
