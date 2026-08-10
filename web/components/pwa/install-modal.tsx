"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { QrCode } from "@/components/shared/qr-code"
import { useInstallPrompt } from "@/hooks/use-install-prompt"
import { absoluteUrl, SITE_NAME } from "@/lib/site"
import type { InstallModalProps } from "@/types"
import { InstallInstructions } from "./install-instructions"

/**
 * Controlled install dialog. Owns the install-prompt hook and picks the right
 * guidance (native prompt / iOS steps / generic hint); closes itself once the
 * native install is accepted. A QR encodes the install URL for cross-device.
 *
 * Built on the Dialog primitive — focus trap, Esc-to-close, and the labelled
 * title come for free (root CLAUDE.md §13.1 / §13.8).
 */
export function InstallModal({ open, onOpenChange }: InstallModalProps) {
  const { canPrompt, isIOS, promptInstall } = useInstallPrompt()
  const [installing, setInstalling] = useState(false)

  async function handleInstall() {
    setInstalling(true)
    const outcome = await promptInstall()
    setInstalling(false)
    if (outcome === "accepted") onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Install {SITE_NAME}</DialogTitle>
          <DialogDescription>
            Add the app to your device — full-screen, fast, and it opens even
            offline. No app store needed.
          </DialogDescription>
        </DialogHeader>

        <InstallInstructions
          canPrompt={canPrompt}
          isIOS={isIOS}
          installing={installing}
          onInstall={handleInstall}
        />

        <div className="flex flex-col items-center gap-2 border-t border-border pt-4">
          <QrCode
            value={absoluteUrl()}
            label={`Scan to open ${SITE_NAME} on another device`}
            size={148}
          />
          <p className="text-xs text-muted-foreground">
            Or scan to open on your phone
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
