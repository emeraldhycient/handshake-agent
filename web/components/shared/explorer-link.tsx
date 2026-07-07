import { ExternalLinkIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ExplorerLinkProps } from "@/types/transaction"

/** Opens an on-chain transaction on the network's block explorer (new tab). */
export function ExplorerLink({ href }: ExplorerLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View on explorer"
      className={cn(
        "ml-1 inline-flex h-5 w-5 flex-none items-center justify-center rounded transition-colors",
        "text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      )}
    >
      <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  )
}
