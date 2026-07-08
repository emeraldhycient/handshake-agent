"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CopyButtonProps } from "@/types/transaction"

/** Copy-to-clipboard icon button with a 2s "copied" state (a11y: labeled). */
export function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

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
        "ml-1 inline-flex h-5 w-5 flex-none items-center justify-center rounded transition-colors",
        "text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      )}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-success" aria-hidden="true" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  )
}
