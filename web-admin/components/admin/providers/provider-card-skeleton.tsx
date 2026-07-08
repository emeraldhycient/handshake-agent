import { Skeleton } from "@/components/ui/skeleton"

/** A provider card's loading placeholder (mark + name/kind + pill + key row). */
export function ProviderCardSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 flex items-center gap-3" aria-busy="true">
        <Skeleton className="size-10 flex-none rounded-[11px]" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-2.5 w-40" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="mb-2.5 h-9 w-full rounded-[10px]" />
      <Skeleton className="h-3 w-48" />
    </div>
  )
}
