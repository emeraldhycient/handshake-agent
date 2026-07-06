import { Money } from "@/components/shared/money"
import { StatusPill } from "@/components/shared/status-pill"
import { DataTable } from "@/components/shared/data-table"
import { QueryEmptyState } from "@/components/shared/query-states"
import type { DataTableColumn } from "@/types/data-table"
import type { RecentActivityTableProps } from "@/types/overview"
import type { ActivityItem } from "@/lib/schemas"

const COLUMNS: DataTableColumn<ActivityItem>[] = [
  {
    key: "icon",
    header: "",
    widthClassName: "w-[47px]",
    render: (item) => (
      <div
        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] text-base font-bold"
        style={{ backgroundColor: item.tint, color: item.col }}
      >
        {item.icon}
      </div>
    ),
  },
  {
    key: "body",
    header: "",
    render: (item) => (
      <div>
        <p className="text-sm font-bold text-foreground">{item.title}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{item.sub}</p>
      </div>
    ),
  },
  {
    key: "amount",
    header: "",
    align: "right",
    render: (item) => (
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
  const items = groups.flatMap((g) => g.items)
  return (
    <div className="rounded-[18px] border border-border bg-card">
      <p className="border-b border-border px-[22px] pt-[15px] pb-[11px] text-xs font-bold tracking-widest text-muted-foreground uppercase">
        Recent activity
      </p>
      <DataTable
        ariaLabel="Recent activity"
        columns={COLUMNS}
        rows={items}
        getRowKey={(item) => item.id}
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
