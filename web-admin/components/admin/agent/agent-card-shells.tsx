import { Skeleton } from "@/components/ui/skeleton"
import type { AgentCardShellProps, InlineErrorProps } from "@/types/components"

/** A card shell — its title is stable across every async branch. */
export function CardShell({
  title,
  suffix,
  aside,
  children,
}: AgentCardShellProps) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-extrabold text-ink">
          {title}
          {suffix ? (
            <span className="font-semibold text-ink3"> {suffix}</span>
          ) : null}
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** Five-row loading skeleton, shared by every card. */
export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2 py-1" aria-busy="true">
      <Skeleton className="h-[19px] w-full" />
      <Skeleton className="h-[19px] w-full" />
      <Skeleton className="h-[19px] w-full" />
      <Skeleton className="h-[19px] w-full" />
      <Skeleton className="h-[19px] w-full" />
    </div>
  )
}

/** The shared error branch — a message + a Retry that re-runs the query. */
export function CardError({ label, onRetry }: InlineErrorProps) {
  return (
    <div className="rounded-xl border border-sdn bg-sdn/40 px-3.5 py-3 text-center">
      <p className="text-xs font-bold text-tdn">{label}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1.5 cursor-pointer rounded-md px-1.5 text-[11.5px] font-bold text-tif hover:bg-hov focus-visible:outline focus-visible:outline-2 focus-visible:outline-tif"
      >
        Retry
      </button>
    </div>
  )
}
