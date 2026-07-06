import { LockIcon, LoaderCircleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { ConfirmActionsProps } from "@/types/chat"

/**
 * Confirm-overlay action buttons. On an expired quote the PIN CTA is replaced
 * with a disabled "request a new one" button so the user can never reach PIN
 * entry against a dead quote (the server re-checks as the backstop).
 */
export function ConfirmActions({
  isExpired,
  loading,
  cta,
  onConfirm,
  onCancel,
}: ConfirmActionsProps) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      {isExpired ? (
        <Button
          onClick={onCancel}
          disabled
          aria-disabled
          className="w-full cursor-not-allowed gap-2 bg-muted py-4 text-base font-bold text-muted-foreground"
        >
          Quote expired — request a new one
        </Button>
      ) : (
        <Button
          onClick={onConfirm}
          disabled={loading}
          className={cn(
            "w-full gap-2 bg-accent py-4 text-base font-bold text-accent-foreground",
            "hover:bg-accent-deep",
            loading && "cursor-not-allowed opacity-70"
          )}
        >
          {loading ? (
            <LoaderCircleIcon
              className="h-[15px] w-[15px] animate-spin"
              aria-hidden="true"
            />
          ) : (
            <LockIcon className="h-[15px] w-[15px]" aria-hidden="true" />
          )}
          {loading ? "Authorizing…" : cta}
        </Button>
      )}
      <Button
        variant="ghost"
        onClick={onCancel}
        disabled={loading}
        className="w-full text-sm font-semibold text-muted-foreground"
      >
        {isExpired ? "Close" : "Cancel"}
      </Button>
    </div>
  )
}
