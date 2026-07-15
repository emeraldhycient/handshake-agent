"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CopyButtonProps } from "@/types/transaction"

/** Copy-to-clipboard icon button with a 2s "copied" state (a11y: labeled). */
export function CopyButton({
  value,
  label,
  tone = "default",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const onDark = tone === "onDark"

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={cn(
        "ml-1 inline-flex h-5 w-5 flex-none items-center justify-center rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
        onDark
          ? "text-membership-mint-icon hover:text-membership-mint"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {copied ? (
        <CheckIcon
          className={cn(
            "h-3.5 w-3.5",
            onDark ? "text-membership-mint" : "text-success"
          )}
          aria-hidden="true"
        />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  )
}
