"use client"

/**
 * TreasuryPage — the treasury oversight surface (Phase 3, sub-area D): aggregated
 * custodial balances, exposure-vs-limit snapshots, threshold-breach alerts (with a
 * step-up-gated Acknowledge), and per-wallet withdrawal policies.
 *
 * Each section is an independent query with its own four async branches (loading /
 * error / empty / data). Nothing here moves money (§3.1) — these are read-only
 * projections plus an audited acknowledgement annotation. Presentation follows the
 * operator-console design system (§6.13 Treasury): optional low-float warning,
 * balance cards with a dark custodial hero, and a 1.5fr/1fr grid (alerts queue |
 * withdrawal policies).
 */
import { useState } from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  useAcknowledgeAlert,
  useAdminMe,
  useTreasuryAlerts,
  useTreasuryBalances,
  useTreasuryExposure,
  useWithdrawalPolicies,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type {
  TreasuryAlert,
  TreasuryAlertSeverity,
  TreasuryBalance,
  TreasuryExposureStatus,
} from "@handshake-agent/contracts"

// The hero balance tile — a dark-green gradient identical in both themes (§5 KPI
// hero / §6.13 "one dark hero for custodial/USDT").
const HERO_GRADIENT =
  "linear-gradient(150deg, var(--brand-green) 0%, var(--brand-green-deep) 100%)"

const EXPOSURE_VARIANT: Record<
  TreasuryExposureStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  safe: "success",
  warning: "warn",
  critical: "danger",
}

const ALERT_VARIANT: Record<
  TreasuryAlertSeverity,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  info: "info",
  warning: "warn",
  critical: "danger",
}

/** The hero tile represents the custodial position — USDT on the launch network. */
function isCustodialHero(balance: TreasuryBalance): boolean {
  return balance.asset.toUpperCase() === "USDT"
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

function SectionShell({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-extrabold text-ink">{title}</h2>
        {note && (
          <span className="text-[11px] font-semibold text-ink3">{note}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  )
}

function ErrorPanel({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-sdn bg-sdn/40 p-4 text-center">
      <p className="text-[12.5px] font-bold text-tdn">Failed to load {what}</p>
    </div>
  )
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-8 text-center text-[12.5px] text-ink3">
      {children}
    </div>
  )
}

export function TreasuryPage() {
  const balances = useTreasuryBalances()
  const exposure = useTreasuryExposure()
  const alerts = useTreasuryAlerts()
  const policies = useWithdrawalPolicies()

  const me = useAdminMe()
  const acknowledge = useAcknowledgeAlert()
  const stepUp = useStepUpRetry()
  const [noteByAlert, setNoteByAlert] = useState<Record<string, string>>({})
  const [localError, setLocalError] = useState<string | null>(null)

  // Low-float warning is derived from live data — surfaced when any exposure
  // snapshot has breached (warning/critical) or an unacknowledged critical alert
  // is open. This mirrors the design's optional amber banner (§6.13) without a
  // hardcoded flag.
  const lowFloat =
    (exposure.isSuccess &&
      exposure.data.items.some((e) => e.status !== "safe")) ||
    (alerts.isSuccess &&
      alerts.data.items.some(
        (a) => a.severity === "critical" && !a.acknowledgedAt
      ))

  function onAcknowledge(id: string) {
    setLocalError(null)
    const note = noteByAlert[id]?.trim()
    void (async () => {
      try {
        await stepUp.run(() =>
          acknowledge
            .mutateAsync({ id, input: note ? { note } : {} })
            .then(() => undefined)
        )
      } catch (error) {
        setLocalError(errorMessage(error))
      }
    })()
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-[26px_30px_60px]">
      <div>
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Treasury
        </h1>
        <p className="mt-1 text-[13.5px] text-ink2">
          Custodial wallet balances, exposure vs limit, threshold alerts and
          per-wallet withdrawal policies.
        </p>
      </div>

      {/* ── Low-float warning (optional, derived from live data) ─────────────── */}
      {lowFloat && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-swn bg-swn px-4 py-3"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0 text-twn"
          >
            <path
              d="M12 4l9 16H3zM12 10v4M12 17h.01"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[12.5px] font-semibold text-twn">
            Exposure alert · a treasury position has breached its limit. Review
            before authorizing large payouts.
          </span>
        </div>
      )}

      {/* ── Balance cards (dark custodial hero) ──────────────────────────────── */}
      <SectionShell title="Aggregated balances">
        {balances.isLoading && <LoadingRows />}
        {balances.isError && <ErrorPanel what="balances" />}
        {balances.isSuccess && balances.data.balances.length === 0 && (
          <EmptyPanel>No custodial balances.</EmptyPanel>
        )}
        {balances.isSuccess && balances.data.balances.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
            {balances.data.balances.map((b) => {
              const hero = isCustodialHero(b)
              return (
                <div
                  key={`${b.network}-${b.asset}`}
                  style={hero ? { background: HERO_GRADIENT } : undefined}
                  className={
                    hero
                      ? "rounded-2xl border border-transparent p-4 text-white"
                      : "rounded-2xl border border-line bg-card p-4 text-ink"
                  }
                >
                  <div
                    className={
                      hero
                        ? "text-[11.5px] font-semibold text-white/70"
                        : "text-[11.5px] font-semibold text-ink2"
                    }
                  >
                    {b.asset} · {b.network}
                  </div>
                  <div className="mt-1.5 font-mono text-[21px] font-extrabold tracking-[-0.01em] tabular-nums">
                    {b.totalAmount}
                  </div>
                  <div
                    className={
                      hero
                        ? "mt-2 text-[11px] text-white/70"
                        : "mt-2 text-[11px] text-ink3"
                    }
                  >
                    {b.walletCount} wallet{b.walletCount === 1 ? "" : "s"}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionShell>

      {/* ── Exposure vs limit ────────────────────────────────────────────────── */}
      <SectionShell title="Exposure vs limit">
        {exposure.isLoading && <LoadingRows />}
        {exposure.isError && <ErrorPanel what="exposure" />}
        {exposure.isSuccess && exposure.data.items.length === 0 && (
          <EmptyPanel>No exposure snapshots.</EmptyPanel>
        )}
        {exposure.isSuccess && exposure.data.items.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-line bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Net exposure</TableHead>
                  <TableHead className="text-right">Limit (bps)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exposure.data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-semibold text-ink">
                      {e.asset} · {e.fiatCurrency}
                    </TableCell>
                    <TableCell>
                      <Badge variant={EXPOSURE_VARIANT[e.status]}>
                        {e.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {e.netExposure}
                    </TableCell>
                    <TableCell className="text-right font-mono text-ink2 tabular-nums">
                      {e.exposureLimitBps}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionShell>

      {/* ── Alerts queue | Withdrawal policies (1.5fr / 1fr) ─────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Exposure alerts — maker-checker-tagged approval queue */}
        <SectionShell
          title="Exposure alerts"
          note="Acknowledgement requires step-up"
        >
          {alerts.isLoading && <LoadingRows />}
          {alerts.isError && <ErrorPanel what="alerts" />}
          {alerts.isSuccess && alerts.data.items.length === 0 && (
            <EmptyPanel>No open alerts.</EmptyPanel>
          )}
          {alerts.isSuccess && alerts.data.items.length > 0 && (
            <ul className="flex flex-col gap-2.5">
              {alerts.data.items.map((alert: TreasuryAlert) => (
                <li
                  key={alert.id}
                  className="rounded-2xl border border-line bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <Badge variant={ALERT_VARIANT[alert.severity]}>
                          {alert.severity}
                        </Badge>
                        <span className="text-[13px] font-bold text-ink">
                          {alert.asset}
                        </span>
                        {alert.severity === "critical" && (
                          <span className="rounded-md bg-swn px-2 py-0.5 text-[9.5px] font-extrabold tracking-[0.04em] text-twn uppercase">
                            Maker-checker
                          </span>
                        )}
                        {alert.acknowledgedAt && (
                          <Badge variant="neutral">acknowledged</Badge>
                        )}
                      </div>
                      <p className="text-[12px] text-ink2">{alert.message}</p>
                      <p className="font-mono text-[11px] text-ink3 tabular-nums">
                        Net {alert.netExposure} ·{" "}
                        {formatDate(alert.triggeredAt)}
                      </p>
                    </div>
                    {!alert.acknowledgedAt && (
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label={`Acknowledgement note for ${alert.asset}`}
                          className="h-9 w-44"
                          placeholder="Note (optional)"
                          value={noteByAlert[alert.id] ?? ""}
                          disabled={acknowledge.isPending}
                          onChange={(e) =>
                            setNoteByAlert((prev) => ({
                              ...prev,
                              [alert.id]: e.target.value,
                            }))
                          }
                        />
                        <Button
                          size="sm"
                          variant="green"
                          disabled={acknowledge.isPending}
                          onClick={() => onAcknowledge(alert.id)}
                        >
                          Approve
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {localError && (
            <p role="alert" className="text-[11px] font-semibold text-tdn">
              {localError}
            </p>
          )}
        </SectionShell>

        {/* Withdrawal policies — per-wallet controls */}
        <SectionShell title="Withdrawal policies">
          {policies.isLoading && <LoadingRows />}
          {policies.isError && <ErrorPanel what="withdrawal policies" />}
          {policies.isSuccess && policies.data.items.length === 0 && (
            <EmptyPanel>No active withdrawal policies.</EmptyPanel>
          )}
          {policies.isSuccess && policies.data.items.length > 0 && (
            <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
              <ul className="flex flex-col">
                {policies.data.items.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 border-b border-line2 py-3 last:border-0"
                  >
                    <span
                      aria-hidden="true"
                      className={
                        p.requiresApproval
                          ? "size-2 shrink-0 rounded-full bg-twn"
                          : "size-2 shrink-0 rounded-full bg-tok"
                      }
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink2">
                      {p.walletId.slice(0, 12)}…
                    </span>
                    <span className="font-mono text-[12px] font-bold tabular-nums">
                      {p.maxWithdrawalPerTx ?? "—"}
                    </span>
                    <span className="text-[10.5px] font-bold text-ink3">
                      {p.requiresApproval ? "approval" : "auto"}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3.5 flex justify-between border-t border-line2 pt-3">
                <span className="text-[11.5px] text-ink3">Allow-list mode</span>
                <span className="font-mono text-[12px] font-bold text-ink2">
                  {policies.data.items[0]?.allowListMode ?? "—"}
                </span>
              </div>
            </div>
          )}
        </SectionShell>
      </div>

      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .catch((error) => setLocalError(errorMessage(error)))
        }}
      />
    </div>
  )
}
