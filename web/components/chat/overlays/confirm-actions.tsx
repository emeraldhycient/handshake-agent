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
          size="xl"
          onClick={onCancel}
          disabled
          aria-disabled
          className="w-full cursor-not-allowed gap-2 bg-muted font-bold text-muted-foreground"
        >
          Quote expired — request a new one
        </Button>
      ) : (
        <Button
          variant="accent"
          size="xl"
          onClick={onConfirm}
          disabled={loading}
          className={cn(
            "w-full gap-2",
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
        variant="outline"
        size="xl"
        onClick={onCancel}
        disabled={loading}
        className="w-full font-semibold"
      >
        {isExpired ? "Close" : "Cancel"}
      </Button>
    </div>
  )
}
