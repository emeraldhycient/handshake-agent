"use client"

import { useState } from "react"
import { BrandMark } from "@/components/shared/brand-mark"
import { QrCode } from "@/components/shared/qr-code"
import { useInstallPrompt } from "@/hooks/use-install-prompt"
import { absoluteUrl, SITE_NAME, SITE_TAGLINE } from "@/lib/site"
import { InstallInstructions } from "./install-instructions"

/**
 * The shareable install page body (/download). Renders a scannable QR that opens
 * the app's install URL on any device, plus the capability-aware install
 * guidance. Client component — the guidance depends on the visitor's browser.
 */
export function DownloadExperience() {
  const { canPrompt, isIOS, promptInstall } = useInstallPrompt()
  const [installing, setInstalling] = useState(false)
  const installUrl = absoluteUrl()

  async function handleInstall() {
    setInstalling(true)
    await promptInstall()
    setInstalling(false)
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-card">
      <div className="mb-5 flex justify-center">
        <BrandMark size={56} ariaLabel={SITE_NAME} />
      </div>

      <h1 className="text-2xl font-bold text-foreground">
        Install {SITE_NAME}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{SITE_TAGLINE}</p>

      <div className="mt-6 flex flex-col items-center gap-3">
        <QrCode
          value={installUrl}
          label={`Scan to install ${SITE_NAME}`}
          size={196}
        />
        <p className="text-xs text-muted-foreground">
          Scan with your phone camera to open the app, then install it.
        </p>
      </div>

      <div className="mt-7 border-t border-border pt-6 text-left">
        <InstallInstructions
          canPrompt={canPrompt}
          isIOS={isIOS}
          installing={installing}
          onInstall={handleInstall}
        />
      </div>
    </div>
  )
}
