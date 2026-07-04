"use client"

/**
 * MetricsDashboard — the admin operational dashboard (Phase 5, FINAL).
 *
 * A date-range preset picker (Last 7 / 30 / 90 days; default 30) drives a single
 * composite query (`useDashboardMetrics`). The body renders: a KPI stat grid
 * whose first tile is the dark-green "hero" (total txns, success rate, active
 * users, revenue), the transaction-volume as a labelled daily bar chart plus a
 * per-type breakdown table, and the KYC funnel + service-health as cards.
 *
 * Read-only projections — nothing here moves money (§3.1). Four async branches:
 * loading skeletons / error / empty / data. Tokens only; aria-labels throughout.
 *
 * On the ungated home page (`gracefulOnForbidden`) a 403 (no Metrics grant)
 * degrades to a friendly empty state instead of an error (§3.3 — UX gate).
 */
import { useMemo, useState } from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { MetricsBar } from "@/components/admin/metrics-bar"
import { cn } from "@/lib/utils"
import { rangeForDays } from "@/lib/metrics-range"
import { formatMoneyList } from "@/lib/format"
import { TrendChart } from "@/components/admin/trend-chart"
import { MoneyTrendCard } from "@/components/admin/money-trend-card"
import { ExportCsvButton } from "@/components/admin/export-csv-button"
import { FeatureCard, CardHeading } from "@/components/admin/feature-card"
import { useDashboardMetrics, useMoneySeries } from "@/lib/query/hooks"
import { ApiError } from "@/lib/api/client"
import type { DashboardSummary } from "@handshake-agent/contracts"
import type { MetricsDashboardProps } from "@/types/components"

// ─── Range presets ────────────────────────────────────────────────────────────────

interface RangePreset {
  readonly id: string
  readonly label: string
  readonly days: number
}

const RANGE_PRESETS: readonly RangePreset[] = [
  { id: "7d", label: "7d", days: 7 },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
]

const DEFAULT_PRESET_ID = "30d"

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

// ─── Shared layout primitives ───────────────────────────────────────────────────────

/**
 * KPI stat tile (§5). Tile 0 is the dark-green "hero" — a brand-green→deep
 * gradient with white ink and an amber delta chip; other tiles use the card
 * surface with a success/warn muted delta chip.
 */
function KpiTile({
  label,
  value,
  delta,
  deltaNote,
  footnote,
  hero = false,
  warn = false,
}: {
  label: string
  value: string
  delta?: string
  deltaNote?: string
  footnote?: string
  hero?: boolean
  warn?: boolean
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-[16px_17px]",
        hero
          ? "border-transparent bg-[linear-gradient(150deg,var(--brand-green)_0%,var(--brand-green-deep)_100%)] text-white"
          : "border-line bg-card text-ink"
      )}
    >
      <div
        className={cn(
          "text-xs font-semibold",
          hero ? "text-on-brand-muted" : "text-ink2"
        )}
      >
        {label}
      </div>
      <div className="mt-1.5 text-[26px] leading-none font-extrabold tracking-tight tabular-nums">
        {value}
      </div>
      {(delta || deltaNote) && (
        <div className="mt-2.5 flex items-center gap-1.5">
          {delta && (
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[11px] font-bold",
                hero
                  ? "bg-brand-amber text-brand-green-deep"
                  : warn
                    ? "bg-swn text-twn"
                    : "bg-sok text-tok"
              )}
            >
              {delta}
            </span>
          )}
          {deltaNote && (
            <span
              className={cn(
                "text-[11px]",
                hero ? "text-on-brand-muted" : "text-ink2"
              )}
            >
              {deltaNote}
            </span>
          )}
        </div>
      )}
      {footnote && (
        <div
          className={cn(
            "mt-2 text-[10.5px] leading-snug",
            hero ? "text-on-brand-muted" : "text-ink3"
          )}
        >
          {footnote}
        </div>
      )}
    </div>
  )
}

// ─── Section renderers (data branch) ────────────────────────────────────────────────

function KpiGrid({ data }: { data: DashboardSummary }) {
  const { txnVolume, activeUsers, revenue } = data
  const totalTxns = txnVolume.byType.reduce((sum, t) => sum + t.count, 0)
  // Per-currency (each with its own symbol), never first-currency-only (#11/#12).
  const revenueValue = formatMoneyList(revenue.totalFeesByCurrency)
  const revenueNote =
    revenue.totalFeesByCurrency.length === 0 ? "No fee revenue" : "fees collected"
  // Profit = fees + realized spread, derived per completed buy/sell (docs §5).
  const profitFootnote = `Profit ${formatMoneyList(revenue.totalProfitByCurrency)} (fees + spread)`

  return (
    <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        hero
        label="Total transactions"
        value={totalTxns.toLocaleString()}
        delta={formatPct(txnVolume.successRate)}
        deltaNote="success rate"
      />
      <KpiTile
        label="Success rate"
        value={formatPct(txnVolume.successRate)}
        delta={`${revenue.txnCount.toLocaleString()}`}
        deltaNote="completed"
      />
      <KpiTile
        label="Active users"
        value={activeUsers.activeInRange.toLocaleString()}
        delta={`+${activeUsers.newInRange.toLocaleString()}`}
        deltaNote={`new · ${activeUsers.totalUsers.toLocaleString()} total`}
      />
      <KpiTile
        label="Revenue (fees)"
        value={revenueValue}
        deltaNote={revenueNote}
        footnote={profitFootnote}
        warn={revenue.totalFeesByCurrency.length === 0}
      />
    </div>
  )
}

/** Fixed capability colors for the stacked/labelled volume bars (§5). */
const VOLUME_SEGMENTS = [
  { key: "completed", label: "Completed", color: "var(--brand-green)" },
  { key: "failed", label: "Failed", color: "var(--brand-amber)" },
] as const

function TxnVolumeCard({ data }: { data: DashboardSummary }) {
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

function KycFunnelCard({ data }: { data: DashboardSummary }) {
  const { byStatus, byTier } = data.kycFunnel
  const statusMax = byStatus.reduce((m, s) => Math.max(m, s.count), 0)
  const tierMax = byTier.reduce((m, t) => Math.max(m, t.count), 0)

  return (
    <FeatureCard className="flex flex-col gap-4">
      <CardHeading title="KYC funnel" note="current population" />
      <div>
        <div className="mb-2 text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase">
          By status
        </div>
        {byStatus.length === 0 ? (
          <p className="text-[12.5px] text-ink3">No users.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {byStatus.map((s) => (
              <MetricsBar
                key={s.status}
                label={s.status}
                value={s.count}
                max={statusMax}
                caption={s.count.toLocaleString()}
              />
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase">
          By tier
        </div>
        {byTier.length === 0 ? (
          <p className="text-[12.5px] text-ink3">No users.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {byTier.map((t) => (
              <MetricsBar
                key={t.tier}
                label={t.tier}
                value={t.count}
                max={tierMax}
                caption={t.count.toLocaleString()}
              />
            ))}
          </div>
        )}
      </div>
    </FeatureCard>
  )
}

function ServiceHealthCard({ data }: { data: DashboardSummary }) {
  const { services } = data.serviceHealth

  return (
    <FeatureCard>
      <div className="mb-3.5">
        <CardHeading title="Service health" note="success rate by service" />
      </div>
      {services.length === 0 ? (
        <p className="text-[12.5px] text-ink3">No service activity.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {services.map((s) => (
            <div
              key={s.service}
              className="flex flex-col gap-2 border-b border-line2 pb-3 last:border-0 last:pb-0"
            >
              <MetricsBar
                label={s.service}
                value={s.successRate}
                max={1}
                caption={formatPct(s.successRate)}
              />
              <div className="flex gap-4 text-[10.5px] text-ink3 tabular-nums">
                <span>{s.total.toLocaleString()} total</span>
                <span className="text-tok">
                  {s.completed.toLocaleString()} completed
                </span>
                <span className="text-tdn">
                  {s.failed.toLocaleString()} failed
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </FeatureCard>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────────

export function MetricsDashboard({
  gracefulOnForbidden = false,
}: MetricsDashboardProps) {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID)
  const preset =
    RANGE_PRESETS.find((p) => p.id === presetId) ?? RANGE_PRESETS[1]
  const range = useMemo(() => rangeForDays(preset.days), [preset.days])

  const query = useDashboardMetrics(range)
  const moneySeries = useMoneySeries(range)
  const isForbidden =
    query.error instanceof ApiError && query.error.status === 403

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      <div className="mx-auto w-full max-w-[1320px] px-[30px] pt-[26px] pb-[60px]">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="mb-[22px] flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">
              Operations overview
            </h1>
            <p className="mt-1.5 text-[13.5px] text-ink2">
              Live platform health, money movement, and what needs your
              attention.
            </p>
          </div>
          <div
            role="group"
            aria-label="Date range"
            className="flex rounded-[11px] border border-line bg-card p-[3px]"
          >
            {RANGE_PRESETS.map((p) => {
              const active = p.id === presetId
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPresetId(p.id)}
                  className={cn(
                    "cursor-pointer rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    active
                      ? "bg-btn-dark text-white"
                      : "text-ink2 hover:text-ink"
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Loading ──────────────────────────────────────────────────────── */}
        {query.isLoading && (
          <div className="flex flex-col gap-4" aria-busy="true">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <Skeleton className="h-[92px] rounded-2xl" />
              <Skeleton className="h-[92px] rounded-2xl" />
              <Skeleton className="h-[92px] rounded-2xl" />
              <Skeleton className="h-[92px] rounded-2xl" />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
              <Skeleton className="h-64 rounded-[18px]" />
              <Skeleton className="h-64 rounded-[18px]" />
            </div>
          </div>
        )}

        {/* ── Error (or graceful no-access) ────────────────────────────────── */}
        {query.isError &&
          (gracefulOnForbidden && isForbidden ? (
            <div className="flex flex-1 items-center justify-center py-16">
              <div className="max-w-md rounded-[18px] border border-swn bg-swn/40 p-6 text-center">
                <p className="text-sm font-bold text-twn">No metrics access</p>
                <p className="mt-1 text-[12.5px] text-ink2">
                  Your role can&apos;t view the operational dashboard. Ask a
                  super admin to grant the Metrics permission.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-[18px] border border-sdn bg-sdn/40 p-6 text-center">
              <p className="text-sm font-bold text-tdn">
                Failed to load metrics
              </p>
              <p className="mt-1 text-[12.5px] text-ink2">
                Please refresh the page.
              </p>
            </div>
          ))}

        {/* ── Data ─────────────────────────────────────────────────────────── */}
        {query.isSuccess && (
          <>
            <KpiGrid data={query.data} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
              <TxnVolumeCard data={query.data} />
              <ServiceHealthCard data={query.data} />
            </div>
            <div className="mt-4">
              <MoneyTrendCard
                data={moneySeries.data}
                isLoading={moneySeries.isLoading}
                isError={moneySeries.isError}
              />
            </div>
            <div className="mt-4">
              <KycFunnelCard data={query.data} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
