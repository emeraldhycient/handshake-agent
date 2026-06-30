"use client"

/**
 * TreasuryPage — the treasury oversight surface (Phase 3, sub-area D): aggregated
 * custodial balances, exposure-vs-limit snapshots, threshold-breach alerts (with a
 * step-up-gated Acknowledge), and per-wallet withdrawal policies.
 *
 * Each section is an independent query with its own four async branches (loading /
 * error / empty / data). Nothing here moves money (§3.1) — these are read-only
 * projections plus an audited acknowledgement annotation.
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
  TreasuryAlertSeverity,
  TreasuryExposureStatus,
} from "@handshake-agent/contracts"

const EXPOSURE_VARIANT: Record<
  TreasuryExposureStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  safe: "default",
  warning: "secondary",
  critical: "destructive",
}

const ALERT_VARIANT: Record<
  TreasuryAlertSeverity,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  info: "secondary",
  warning: "secondary",
  critical: "destructive",
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

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  )
}

function ErrorPanel({ what }: { what: string }) {
  return (
    <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-4 text-center">
      <p className="text-sm font-semibold text-destructive">
        Failed to load {what}
      </p>
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
    <div className="flex flex-1 flex-col gap-7 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Treasury
        </h1>
      </div>

      {/* ── Balances ─────────────────────────────────────────────────────── */}
      <SectionShell title="Aggregated balances">
        {balances.isLoading && <LoadingRows />}
        {balances.isError && <ErrorPanel what="balances" />}
        {balances.isSuccess && balances.data.balances.length === 0 && (
          <p className="text-sm text-muted-foreground">No balances.</p>
        )}
        {balances.isSuccess && balances.data.balances.length > 0 && (
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Network</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Wallets</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.data.balances.map((b) => (
                  <TableRow key={`${b.network}-${b.asset}`}>
                    <TableCell className="text-foreground">
                      {b.network}
                    </TableCell>
                    <TableCell className="text-foreground">{b.asset}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {b.totalAmount}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {b.walletCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionShell>

      {/* ── Exposure ─────────────────────────────────────────────────────── */}
      <SectionShell title="Exposure vs limit">
        {exposure.isLoading && <LoadingRows />}
        {exposure.isError && <ErrorPanel what="exposure" />}
        {exposure.isSuccess && exposure.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No exposure snapshots.
          </p>
        )}
        {exposure.isSuccess && exposure.data.items.length > 0 && (
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
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
                    <TableCell className="text-foreground">
                      {e.asset} · {e.fiatCurrency}
                    </TableCell>
                    <TableCell>
                      <Badge variant={EXPOSURE_VARIANT[e.status]}>
                        {e.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.netExposure}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {e.exposureLimitBps}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionShell>

      {/* ── Alerts ───────────────────────────────────────────────────────── */}
      <SectionShell title="Exposure alerts">
        {alerts.isLoading && <LoadingRows />}
        {alerts.isError && <ErrorPanel what="alerts" />}
        {alerts.isSuccess && alerts.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">No alerts.</p>
        )}
        {alerts.isSuccess && alerts.data.items.length > 0 && (
          <ul className="flex flex-col gap-2">
            {alerts.data.items.map((alert) => (
              <li
                key={alert.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-card p-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={ALERT_VARIANT[alert.severity]}>
                      {alert.severity}
                    </Badge>
                    <span className="text-sm font-medium text-foreground">
                      {alert.asset}
                    </span>
                    {alert.acknowledgedAt && (
                      <Badge variant="outline">acknowledged</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {alert.message}
                  </p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    Net {alert.netExposure} · {formatDate(alert.triggeredAt)}
                  </p>
                </div>
                {!alert.acknowledgedAt && (
                  <div className="flex items-end gap-2">
                    <Input
                      aria-label={`Acknowledgement note for ${alert.asset}`}
                      className="w-48"
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
                      variant="outline"
                      disabled={acknowledge.isPending}
                      onClick={() => onAcknowledge(alert.id)}
                    >
                      Acknowledge
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {localError && (
          <p role="alert" className="text-xs text-destructive">
            {localError}
          </p>
        )}
      </SectionShell>

      {/* ── Withdrawal policies ──────────────────────────────────────────── */}
      <SectionShell title="Withdrawal policies">
        {policies.isLoading && <LoadingRows />}
        {policies.isError && <ErrorPanel what="withdrawal policies" />}
        {policies.isSuccess && policies.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No active withdrawal policies.
          </p>
        )}
        {policies.isSuccess && policies.data.items.length > 0 && (
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead className="text-right">Max / tx</TableHead>
                  <TableHead className="text-right">Max / day</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Allow-list</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.walletId.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.maxWithdrawalPerTx ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.maxWithdrawalPerDay ?? "—"}
                    </TableCell>
                    <TableCell>
                      {p.requiresApproval ? (
                        <Badge variant="secondary">required</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          none
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.allowListMode}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionShell>

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
