"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { useInstallPrompt } from "@/hooks/use-install-prompt"
import type { InstallButtonProps } from "@/types"
import { InstallModal } from "./install-modal"

/**
 * The visible "install" affordance in the app chrome. An icon button that opens
 * the install modal; it removes itself entirely once the app is installed
 * (display-mode: standalone), so it never nags an installed user.
 *
 * `tone="chrome"` suits the light topbar; `tone="header"` suits the dark chat
 * header (light-on-green). Both carry an accessible name and a visible focus ring.
 */
export function InstallButton({
  tone = "chrome",
  className,
}: InstallButtonProps) {
  const { isInstalled } = useInstallPrompt()
  const [open, setOpen] = useState(false)

  if (isInstalled) return null

  return (
    <>
      <button
        type="button"
        aria-label="Install app"
        title="Install app"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-10 w-10 flex-none items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2",
          tone === "header"
            ? "border border-white/15 bg-white/10 text-primary-foreground hover:bg-white/20 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-deep"
            : "border border-border bg-card text-muted-foreground hover:bg-card-muted hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card-muted",
          className
        )}
      >
        <Download aria-hidden="true" className="size-[18px]" />
      </button>
      <InstallModal open={open} onOpenChange={setOpen} />
    </>
  )
}
