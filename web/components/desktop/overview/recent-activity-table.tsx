import { Money } from "@/components/shared/money"
import { StatusPill } from "@/components/shared/status-pill"
import { DataTable } from "@/components/shared/data-table"
import { QueryEmptyState } from "@/components/shared/query-states"
import type { DataTableColumn } from "@/types/data-table"
import type { RecentActivityTableProps } from "@/types/overview"
import type { ActivityItem } from "@/lib/schemas"

/**
 * A flattened row keeps its group's date label — the overview shows one flat
 * list (no per-date group headers like the Activity page), so each row states
 * its own date before the time.
 */
interface Row {
  item: ActivityItem
  date: string
}

const COLUMNS: DataTableColumn<Row>[] = [
  {
    // Icon + title/sub grouped in one cell so they read tightly together (like
    // the Activity page rows) — a cell-per-element table would space them apart.
    key: "tx",
    header: "",
    widthClassName: "w-full",
    render: ({ item, date }) => (
      <div className="flex items-center gap-[13px]">
        <div
          className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] text-base font-bold"
          style={{ backgroundColor: item.tint, color: item.col }}
        >
          {item.icon}
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">{item.title}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {date} · {item.sub}
          </p>
        </div>
      </div>
    ),
  },
  {
    key: "amount",
    header: "",
    align: "right",
    render: ({ item }) => (
      <div className="text-right">
        <Money
          value={item.amount}
          as="p"
          className="text-sm font-bold text-foreground"
        />
        <StatusPill tone={item.statusTone} className="mt-0.5 text-[11px]">
          {item.status}
        </StatusPill>
      </div>
    ),
  },
]

/**
 * Recent-activity ledger. A headerless semantic table (root §13 a11y) that
 * grows with its content — the wrapper must NOT be `flex-1`, or the page's
 * overflow-y-auto scroll would clip overflowing rows (regression guard).
 */
export function RecentActivityTable({ groups }: RecentActivityTableProps) {
  const rows: Row[] = groups.flatMap((g) =>
    g.items.map((item) => ({ item, date: g.group }))
  )
  return (
    <div className="rounded-[18px] border border-border bg-card">
      <p className="border-b border-border px-[22px] pt-[15px] pb-[11px] text-xs font-bold tracking-widest text-muted-foreground uppercase">
        Recent activity
      </p>
      <DataTable
        ariaLabel="Recent activity"
        columns={COLUMNS}
        rows={rows}
        getRowKey={({ item }) => item.id}
        hideHeader
        empty={
          <QueryEmptyState
            title="No recent activity"
            description="Your transactions will show up here."
          />
        }
      />
    </div>
  )
}
