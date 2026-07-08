import { Skeleton } from "@/components/ui/skeleton"

/** Skeleton card matching a queues / jobs panel, for the loading branch. */
export function PanelSkeleton() {
  return (
    <div
      className="rounded-2xl border border-line bg-card px-5 py-[18px]"
      aria-busy="true"
    >
      <Skeleton className="mb-3 h-3.5 w-32" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-[11px] border-b border-line2 py-2.5 last:border-b-0"
        >
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}
