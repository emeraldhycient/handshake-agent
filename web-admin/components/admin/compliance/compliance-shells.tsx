import { Table } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import type { CardShellProps, ErrorPanelProps } from "@/types/components"

/** The design table shell: rounded card, hidden overflow, card2 header row. */
export function TableCard({ children }: CardShellProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <Table>{children}</Table>
    </div>
  )
}

/** Skeleton rows for a data-tab's loading branch. */
export function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl" />
    </div>
  )
}

/** A data-tab's tokened error branch. */
export function ErrorPanel({ what }: ErrorPanelProps) {
  return (
    <div className="rounded-2xl border border-sdn bg-sdn/40 p-5 text-center">
      <p className="text-sm font-bold text-tdn">Failed to load {what}</p>
      <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
    </div>
  )
}

/** A data-tab's empty-branch note. */
export function EmptyNote({ children }: CardShellProps) {
  return <p className="text-sm text-ink2">{children}</p>
}
