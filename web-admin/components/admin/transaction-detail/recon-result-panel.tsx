import { Skeleton } from "@/components/ui/skeleton"
import { Panel, PanelTitle } from "@/components/admin/transaction-detail/panel"
import { formatDelta } from "@/lib/format"
import { RECON_KIND_LABEL } from "@/constants/transaction-detail"
import type { TxReconResultProps } from "@/types"

/**
 * The inline result of a "Re-run recon" pass (four branches): loading while the
 * detection runs, an error if it rejected, the reconciled (no-break) note when the
 * list is empty, or the detected breaks. Read-only — this panel only surfaces the
 * provider-vs-ledger discrepancy; remediation lives on the Reconciliation surface.
 */
export function ReconResultPanel({ loading, error, breaks }: TxReconResultProps) {
  return (
    <div className="mt-3.5">
      <Panel>
        <PanelTitle>Reconciliation re-run</PanelTitle>
        {loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-5 w-full rounded" />
            <Skeleton className="h-5 w-2/3 rounded" />
          </div>
        ) : error ? (
          <div className="rounded-[10px] border border-sdn bg-sdn/40 px-3 py-2.5">
            <p className="text-[12.5px] font-bold text-tdn">
              Reconciliation re-run failed
            </p>
            <p className="mt-0.5 text-[11.5px] text-ink2">{error}</p>
          </div>
        ) : breaks && breaks.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {breaks.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-sdn bg-card px-3 py-2.5"
              >
                <span className="text-[12.5px] font-bold text-ink">
                  {RECON_KIND_LABEL[b.kind]}
                </span>
                <span className="font-mono text-[12px] font-extrabold tabular-nums text-tdn">
                  {formatDelta(b.delta, b.asset)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-[7px] text-[12.5px] font-bold text-tok">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="m5 12 5 5L20 7"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Provider and ledger reconcile — no breaks detected.
          </div>
        )}
      </Panel>
    </div>
  )
}
