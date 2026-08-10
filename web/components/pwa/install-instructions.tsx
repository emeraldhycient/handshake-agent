"use client"

import { Download, Share, SquarePlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { InstallInstructionsProps } from "@/types"

/** iOS "Add to Home Screen" steps, keyed for stable list rendering. */
const IOS_STEPS = [
  {
    key: "share",
    icon: Share,
    text: "Tap the Share button in Safari's toolbar.",
  },
  {
    key: "add",
    icon: SquarePlus,
    text: "Choose “Add to Home Screen” from the list.",
  },
  {
    key: "confirm",
    icon: Download,
    text: "Tap “Add” — the app lands on your home screen.",
  },
] as const

export function InstallInstructions({
  canPrompt,
  isIOS,
  installing,
  onInstall,
  className,
}: InstallInstructionsProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {canPrompt ? (
        <Button
          type="button"
          size="lg"
          onClick={onInstall}
          disabled={installing}
          className="w-full"
        >
          <Download aria-hidden="true" />
          {installing ? "Installing…" : "Install app"}
        </Button>
      ) : isIOS ? (
        <ol className="flex flex-col gap-2.5">
          {IOS_STEPS.map((step, i) => {
            const Icon = step.icon
            return (
              <li key={step.key} className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary text-[13px] font-bold text-primary-foreground"
                >
                  {i + 1}
                </span>
                <Icon
                  aria-hidden="true"
                  className="size-4 flex-none text-muted-foreground"
                />
                <span className="text-foreground">{step.text}</span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          Open this site in <strong className="text-foreground">Chrome</strong>{" "}
          or <strong className="text-foreground">Edge</strong>, then use the
          install icon in the address bar to add Handshake Agent to your device.
        </p>
      )}
    </div>
  )
}
