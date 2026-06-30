"use client"

/**
 * MetricsDashboard — the admin operational dashboard (Phase 5, FINAL).
 *
 * A date-range preset picker (Last 7 / 30 / 90 days; default 30) drives a single
 * composite query (`useDashboardMetrics`). The body renders: summary cards (txns,
 * success rate, active users, revenue), transaction volume (per-type table + a
 * daily `MetricsBar` series), the KYC funnel (status + tier bars), and a
 * service-health table (per service totals + a success-rate bar).
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
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { MetricsBar } from "@/components/admin/metrics-bar"
import { useDashboardMetrics } from "@/lib/query/hooks"
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
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
]

const DEFAULT_PRESET_ID = "30d"

/** Build an inclusive `{ from, to }` ISO-date window ending today, N days back. */
function rangeForDays(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - (days - 1))
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

// ─── Shared layout primitives ───────────────────────────────────────────────────────

function SectionShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-bold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border border-border bg-card p-4">
      <p className="text-[10.5px] font-bold tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="text-2xl font-extrabold text-foreground tabular-nums">
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ─── Section renderers (data branch) ────────────────────────────────────────────────

function SummaryCards({ data }: { data: DashboardSummary }) {
  const { txnVolume, activeUsers, revenue } = data
  const totalTxns = txnVolume.byType.reduce((sum, t) => sum + t.count, 0)
  const hasSpread = revenue.totalSpreadByCurrency.length > 0

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total transactions" value={totalTxns.toLocaleString()} />
      <StatCard label="Success rate" value={formatPct(txnVolume.successRate)} />
      <StatCard
        label="Active users"
        value={activeUsers.activeInRange.toLocaleString()}
        hint={`${activeUsers.newInRange.toLocaleString()} new · ${activeUsers.totalUsers.toLocaleString()} total`}
      />
      <div className="flex flex-col gap-1 rounded-[14px] border border-border bg-card p-4">
        <p className="text-[10.5px] font-bold tracking-widest text-muted-foreground uppercase">
          Revenue (fees)
        </p>
        {revenue.totalFeesByCurrency.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fee revenue.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {revenue.totalFeesByCurrency.map((row) => (
              <li
                key={row.currency}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="text-sm font-semibold text-foreground">
                  {row.currency}
                </span>
                <span className="text-sm text-foreground tabular-nums">
                  {row.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!hasSpread && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Spread folded into FX — not separately tracked.
          </p>
        )}
      </div>
    </div>
  )
}

function TxnVolumeSection({ data }: { data: DashboardSummary }) {
  const { byType, series } = data.txnVolume
  const seriesMax = series.reduce((m, b) => Math.max(m, b.count), 0)

  return (
    <SectionShell title="Transaction volume">
      <div className="overflow-hidden rounded-[14px] border border-border bg-card">
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
                <TableCell className="text-foreground">{t.type}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {t.count}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {t.completed}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {t.failed}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {series.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground">
            Daily transactions
          </p>
          <div className="flex flex-col gap-2">
            {series.map((bucket) => (
              <MetricsBar
                key={bucket.date}
                label={bucket.date}
                value={bucket.count}
                max={seriesMax}
                caption={String(bucket.count)}
              />
            ))}
          </div>
        </div>
      )}
    </SectionShell>
  )
}

function KycFunnelSection({ data }: { data: DashboardSummary }) {
  const { byStatus, byTier } = data.kycFunnel
  const statusMax = byStatus.reduce((m, s) => Math.max(m, s.count), 0)
  const tierMax = byTier.reduce((m, t) => Math.max(m, t.count), 0)

  return (
    <SectionShell title="KYC funnel">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground">
            By status
          </p>
          {byStatus.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users.</p>
          ) : (
            byStatus.map((s) => (
              <MetricsBar
                key={s.status}
                label={s.status}
                value={s.count}
                max={statusMax}
                caption={s.count.toLocaleString()}
              />
            ))
          )}
        </div>
        <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground">By tier</p>
          {byTier.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users.</p>
          ) : (
            byTier.map((t) => (
              <MetricsBar
                key={t.tier}
                label={t.tier}
                value={t.count}
                max={tierMax}
                caption={t.count.toLocaleString()}
              />
            ))
          )}
        </div>
      </div>
    </SectionShell>
  )
}

function ServiceHealthSection({ data }: { data: DashboardSummary }) {
  const { services } = data.serviceHealth

  return (
    <SectionShell title="Service health">
      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">No service activity.</p>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="w-[34%]">Success rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((s) => (
                <TableRow key={s.service}>
                  <TableCell className="text-foreground">{s.service}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.total}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {s.completed}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {s.failed}
                  </TableCell>
                  <TableCell>
                    <MetricsBar
                      label={`${s.service} success rate`}
                      value={s.successRate}
                      max={1}
                      caption={formatPct(s.successRate)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionShell>
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
  const isForbidden =
    query.error instanceof ApiError && query.error.status === 403

  return (
    <div className="flex flex-1 flex-col gap-7 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Dashboard
        </h1>
        <div
          role="group"
          aria-label="Date range"
          className="flex items-center gap-1.5"
        >
          {RANGE_PRESETS.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={p.id === presetId ? "default" : "outline"}
              aria-pressed={p.id === presetId}
              onClick={() => setPresetId(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {query.isLoading && (
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-24 rounded-[14px]" />
            <Skeleton className="h-24 rounded-[14px]" />
            <Skeleton className="h-24 rounded-[14px]" />
            <Skeleton className="h-24 rounded-[14px]" />
          </div>
          <Skeleton className="h-48 w-full rounded-[14px]" />
        </div>
      )}

      {/* ── Error (or graceful no-access) ────────────────────────────────── */}
      {query.isError &&
        (gracefulOnForbidden && isForbidden ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md rounded-[14px] border border-warn/30 bg-warn/5 p-6 text-center">
              <p className="text-sm font-semibold text-warn-foreground">
                No metrics access
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your role can&apos;t view the operational dashboard. Ask a super
                admin to grant the Metrics permission.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-4 text-center">
            <p className="text-sm font-semibold text-destructive">
              Failed to load metrics
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Please refresh the page.
            </p>
          </div>
        ))}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {query.isSuccess && (
        <>
          <SummaryCards data={query.data} />
          <TxnVolumeSection data={query.data} />
          <KycFunnelSection data={query.data} />
          <ServiceHealthSection data={query.data} />
        </>
      )}
    </div>
  )
}
