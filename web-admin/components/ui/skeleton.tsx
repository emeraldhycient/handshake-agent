import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-[11px] bg-card2", className)}
      {...props}
    />
  )
}

export { Skeleton }
