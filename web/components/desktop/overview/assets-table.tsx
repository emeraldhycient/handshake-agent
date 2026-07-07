import { AssetIcon } from "@/components/shared/asset-icon"
import { Money } from "@/components/shared/money"
import { DataTable } from "@/components/shared/data-table"
import type { DataTableColumn } from "@/types/data-table"
import type { AssetsTableProps } from "@/types/overview"
import type { WalletAsset } from "@/lib/schemas"

// Price and 24h columns are intentionally absent — no backend source (finding #7).
const COLUMNS: DataTableColumn<WalletAsset>[] = [
  {
    key: "asset",
    header: "Asset",
    widthClassName: "w-[42%]",
    render: (a) => (
      <div className="flex items-center gap-3">
        <AssetIcon sym={a.sym} tint={a.tint} logoUrl={a.logoUrl} size="sm" />
        <div>
          <p className="text-[14.5px] font-bold text-foreground">{a.name}</p>
          <p className="text-xs text-muted-foreground">{a.sub}</p>
        </div>
      </div>
    ),
  },
  {
    key: "holdings",
    header: "Holdings",
    align: "right",
    widthClassName: "w-[29%]",
    render: (a) => (
      <Money
        value={a.amount.split(" ")[0]}
        className="text-sm text-foreground"
      />
    ),
  },
  {
    key: "value",
    header: "Value",
    align: "right",
    widthClassName: "w-[29%]",
    render: (a) => (
      <Money
        value={a.value}
        className="text-[14.5px] font-bold text-foreground"
      />
    ),
  },
]

/** Holdings table for the overview page. */
export function AssetsTable({ assets }: AssetsTableProps) {
  return (
    <div className="rounded-[18px] border border-border bg-card">
      <DataTable
        ariaLabel="Assets"
        columns={COLUMNS}
        rows={assets}
        getRowKey={(a) => a.sym + a.name}
        className="table-fixed"
      />
    </div>
  )
}
