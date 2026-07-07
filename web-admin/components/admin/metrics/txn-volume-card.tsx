import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TrendChart } from "@/components/admin/trend-chart"
import { ExportCsvButton } from "@/components/admin/export-csv-button"
import { FeatureCard, CardHeading } from "@/components/admin/feature-card"
import { VOLUME_SEGMENTS } from "@/constants/metrics"
import type { MetricsCardProps } from "@/types/components"

/**
 * Transaction-volume card — a daily trend line + labelled bar chart (with a legend and
 * CSV export) and a per-type breakdown table. Empty range → a friendly note.
 */
export function TxnVolumeCard({ data }: MetricsCardProps) {
  const { byType, series } = data.txnVolume
  const seriesMax = series.reduce((m, b) => Math.max(m, b.count), 1)
  const volStart = series.length > 0 ? series[0].date : ""

  return (
    <FeatureCard>
      <div className="mb-1 flex items-center justify-between gap-3">
        <CardHeading title="Transaction volume" note="by day · total settled" />
        <div className="flex flex-wrap items-center gap-3">
          {VOLUME_SEGMENTS.map((seg) => (
            <div key={seg.key} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-[3px]"
                style={{ background: seg.color }}
              />
              <span className="text-[11px] font-semibold text-ink2">
                {seg.label}
              </span>
            </div>
          ))}
          <ExportCsvButton
            label="Export"
            filename="transaction-volume.csv"
            disabled={byType.length === 0}
            build={() => ({
              headers: ["type", "count", "completed", "failed", "stuck"],
              rows: byType.map((t) => [
                t.type,
                t.count,
                t.completed,
                t.failed,
                t.stuck,
              ]),
            })}
          />
        </div>
      </div>

      {series.length > 0 ? (
        <>
          <div className="mt-4 h-[64px]">
            <TrendChart
              ariaLabel={`Daily transaction-volume trend over ${series.length} days`}
              points={series.map((b) => ({ label: b.date, value: b.count }))}
            />
          </div>
          <div
            className="mt-3 flex h-[140px] items-end gap-[5px]"
            role="img"
            aria-label={`Daily transaction volume, ${series.length} days, peak ${seriesMax.toLocaleString()}`}
          >
            {series.map((bucket) => {
              const pct = Math.max(
                2,
                Math.round((bucket.count / seriesMax) * 100)
              )
              return (
                <div
                  key={bucket.date}
                  title={`${bucket.date}: ${bucket.count.toLocaleString()}`}
                  className="flex flex-1 flex-col justify-end"
                  style={{ height: "100%" }}
                >
                  <div
                    className="rounded-t-[3px] bg-brand-green transition-[height]"
                    style={{ height: `${pct}%` }}
                  />
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-ink3 tabular-nums">
            <span>{volStart}</span>
            <span>Today</span>
          </div>
        </>
      ) : (
        <p className="mt-3 text-[12.5px] text-ink3">
          No transactions in this range.
        </p>
      )}

      {byType.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-[14px] border border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byType.map((t) => (
                <TableRow key={t.type}>
                  <TableCell className="font-semibold text-ink capitalize">
                    {t.type}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.count.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-ink2 tabular-nums">
                    {t.completed.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-ink2 tabular-nums">
                    {t.failed.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </FeatureCard>
  )
}
