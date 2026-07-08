"use client"

/**
 * TransactionDetailModal — orchestrator. Fetches a transaction by id
 * (useTransactionDetail, one-shot) and renders loading / error / data branches;
 * the populated fields live in TransactionDetailBody (root §16).
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { TransactionDetailBody } from "@/components/shared/transaction-detail-body"
import { useTransactionDetail } from "@/lib/query/hooks"
import { labelFor } from "@/lib/transaction/format"

export interface TransactionDetailModalProps {
  /** Transaction id to load, or null when the modal is closed. */
  transactionId: string | null
  onClose: () => void
}

export function TransactionDetailModal({
  transactionId,
  onClose,
}: TransactionDetailModalProps) {
  const { data, isLoading, isError } = useTransactionDetail(transactionId)

  return (
    <Dialog open={!!transactionId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-sm overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-[16px] font-extrabold">
            {data ? `${labelFor(data.type)} Detail` : "Transaction Detail"}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex flex-col gap-2 px-5 pt-4 pb-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex justify-between py-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-28" />
              </div>
            ))}
          </div>
        )}

        {isError && !isLoading && (
          <div className="flex flex-col items-center gap-2 px-5 pt-4 pb-5 text-center">
            <p className="text-sm font-semibold text-danger">
              Could not load transaction
            </p>
            <p className="text-xs text-muted-foreground">
              Please try again later.
            </p>
          </div>
        )}

        {!isLoading && !isError && data && (
          <TransactionDetailBody data={data} />
        )}
      </DialogContent>
    </Dialog>
  )
}
