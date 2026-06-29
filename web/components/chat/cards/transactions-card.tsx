import { cn } from "@/lib/utils"
import type { TransactionsCardProps } from "@/types/components"

/**
 * TransactionsCard — chat card for a transaction-history query result.
 * Lists rows (date · type · signed amount · status) with in/out color cues
 * (never color alone — the +/- sign carries the meaning too), and a download
 * link to the signed PDF statement. Tokens only, no hex literals.
 */
export function TransactionsCard({
  windowLabel,
  rows,
  totalCount,
  truncated,
  downloadUrl,
  density,
  className,
}: TransactionsCardProps) {
  const isMobile = density === "mobile"

  return (
    <div
      className={cn(
        "overflow-hidden border border-border bg-card",
        isMobile
          ? "w-[88%] rounded-[20px] shadow-card"
          : "w-[92%] rounded-[16px]",
        className
      )}
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <p className="text-[12px] font-bold tracking-widest text-muted-foreground-subtle uppercase">
          Transactions
        </p>
        <span className="text-[12px] text-muted-foreground">{windowLabel}</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-[13.5px] text-muted-foreground">
          No transactions in this period.
        </p>
      ) : (
        <ul className="px-2 pb-1">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-[12px] px-2 py-2.5"
            >
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-foreground">
                  {r.type.toUpperCase()}
                </span>
                <span className="block text-[12px] text-muted-foreground-subtle">
                  {r.sub} · {r.status}
                </span>
              </span>
              <span
                className={cn(
                  "flex-none text-[13.5px] font-bold tabular-nums",
                  r.direction === "in" ? "text-success" : "text-foreground"
                )}
              >
                {r.amount}
              </span>
            </li>
          ))}
        </ul>
      )}

      {truncated && (
        <p className="px-4 pb-1 text-[11.5px] text-muted-foreground-subtle">
          Showing the latest {rows.length} of {totalCount}. Download for the
          full list.
        </p>
      )}

      <div
        className={cn(isMobile ? "px-4 pt-2 pb-4" : "px-[15px] pt-2 pb-[15px]")}
      >
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "block w-full bg-accent text-center font-bold text-accent-foreground shadow-cta",
            isMobile
              ? "rounded-[14px] py-3.5 text-[15px]"
              : "rounded-[12px] py-3 text-[14px]"
          )}
        >
          Download statement (PDF)
        </a>
      </div>
    </div>
  )
}
