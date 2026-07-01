"use client"

/**
 * UserDetail — the end-user aggregate drawer (a right-side Sheet). Opened by the
 * users table with a `userId`; fetches the full aggregate via `useEndUserDetail`
 * and renders identity + KYC summary, sensitive operator actions, devices,
 * balances, recent transactions, recent ledger, and beneficiaries.
 *
 * Four async branches on the detail query: loading / error / empty / data. The
 * Sheet is open whenever `userId !== null`; closing clears the selection upward.
 *
 * Presentation follows the operator-console design system (§6.3 UserDetail):
 * a header card (avatar, name, FROZEN/KYC-tier pills, mono copyable id, flag
 * chips) over card-shaped sections. PII is never revealed here — the aggregate
 * only carries tokenised statuses, balances, and last-seen timestamps.
 */
import { Copy, Fingerprint } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  KycStatusBadge,
  UserStatusBadge,
} from "@/components/admin/user-status-badge"
import { UserActions } from "@/components/admin/user-actions"
import { UserDeviceList } from "@/components/admin/user-device-list"
import { useEndUserDetail } from "@/lib/query/hooks"
import type { AdminEndUserDetail } from "@handshake-agent/contracts"
import type { UserDetailProps } from "@/types/components"

/** Card-shaped section: title 13px/800 over a bordered surface (§5 Card). */
function SectionCard({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-[18px_20px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-extrabold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A label→value row separated by a subtle rule (§5 Card body). */
function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line2 py-2 last:border-b-0">
      <span className="text-[12.5px] text-ink3">{label}</span>
      <span className="text-right text-[12.5px] font-bold text-ink">
        {children}
      </span>
    </div>
  )
}

/** Two-letter initials for the header avatar. */
function initials(user: AdminEndUserDetail): string {
  const source = user.email ?? user.id
  return source.slice(0, 2).toUpperCase()
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

export function UserDetail({ userId, onOpenChange }: UserDetailProps) {
  const detail = useEndUserDetail(userId)
  const user = detail.data

  return (
    <Sheet open={userId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto bg-bg sm:max-w-xl">
        <SheetHeader className="border-b border-line">
          <SheetTitle>User detail</SheetTitle>
          <SheetDescription>
            {user?.email ?? userId ?? "Loading user"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3.5 p-[22px_16px_60px]">
          {/* ── Loading ──────────────────────────────────────────────────── */}
          {detail.isLoading && (
            <div className="flex flex-col gap-3.5" aria-busy="true">
              <Skeleton className="h-24 w-full rounded-[18px]" />
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {detail.isError && (
            <div className="rounded-2xl border border-sdn bg-sdn/40 p-6 text-center">
              <p className="text-sm font-bold text-tdn">
                Failed to load this user
              </p>
              <p className="mt-1 text-xs text-ink2">Close and try again.</p>
            </div>
          )}

          {/* ── Data ─────────────────────────────────────────────────────── */}
          {detail.isSuccess && user && (
            <>
              {/* Header card (§6.3): avatar, name, status/KYC/tier pills,
                  mono copyable id, flag chips. */}
              <header className="rounded-[18px] border border-line bg-card p-5">
                <div className="flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    className="flex size-14 flex-none items-center justify-center rounded-full bg-brand-green text-xl font-extrabold text-white"
                  >
                    {initials(user)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h1 className="text-[21px] font-extrabold tracking-[-0.02em] text-ink">
                        {user.email ?? "User"}
                      </h1>
                      <UserStatusBadge status={user.status} />
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-card2 px-2.5 py-1 text-[11px] font-bold text-ink2">
                        <KycStatusBadge status={user.kycStatus} />
                        <span aria-hidden="true">·</span>
                        {user.kycTier}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard?.writeText(user.id)
                      }
                      title="Copy user id"
                      aria-label="Copy user id"
                      className="mt-1.5 inline-flex items-center gap-1.5 rounded-[6px] font-mono text-xs text-ink3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {user.id}
                      <Copy aria-hidden="true" className="size-3" />
                    </button>
                    {user.simSwapDetectedAt && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-[6px] bg-sdn px-2 py-1 text-[10px] font-extrabold text-tdn">
                          SIM-SWAP {formatDate(user.simSwapDetectedAt)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </header>

              {/* Identity & KYC */}
              <SectionCard title="Identity & KYC">
                <Row label="Status">
                  <UserStatusBadge status={user.status} />
                </Row>
                <Row label="KYC status">
                  <KycStatusBadge status={user.kycStatus} />
                </Row>
                <Row label="Tier">{user.kycTier}</Row>
                <Row label="SIM swap">
                  {user.simSwapDetectedAt
                    ? `Flagged ${formatDate(user.simSwapDetectedAt)}`
                    : "None"}
                </Row>
                <Row label="Created">
                  <span className="tabular-nums">
                    {formatDate(user.createdAt)}
                  </span>
                </Row>
              </SectionCard>

              {/* Actions */}
              <SectionCard title="Actions">
                <UserActions user={user} />
              </SectionCard>

              {/* Devices */}
              <SectionCard title="Devices">
                <UserDeviceList userId={user.id} devices={user.devices} />
                <p className="mt-3 flex items-start gap-2 text-[12px] text-ink3">
                  <Fingerprint
                    aria-hidden="true"
                    className="mt-px size-3.5 flex-none"
                  />
                  Identity = verified KYC + bound device + PIN. A phone number
                  alone never authenticates a session.
                </p>
              </SectionCard>

              {/* Balances */}
              <SectionCard title="Balances">
                {user.balances.length === 0 ? (
                  <p className="text-xs text-ink3">No balances.</p>
                ) : (
                  <div className="flex flex-col">
                    {user.balances.map((b) => (
                      <Row
                        key={`${b.asset}-${b.network}`}
                        label={`${b.asset} · ${b.network}`}
                      >
                        <span className="font-mono tabular-nums">
                          {b.amount}
                        </span>
                      </Row>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* Recent transactions */}
              <SectionCard title="Recent transactions">
                {user.recentTransactions.length === 0 ? (
                  <p className="text-xs text-ink3">No transactions.</p>
                ) : (
                  <ul className="flex flex-col">
                    {user.recentTransactions.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-3 border-b border-line2 py-2.5 last:border-b-0"
                      >
                        <span className="text-[12.5px] font-bold text-ink capitalize">
                          {t.type}
                        </span>
                        <span className="text-[11px] text-ink2">
                          {t.status}
                        </span>
                        <span className="text-[11px] text-ink3 tabular-nums">
                          {formatDate(t.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              {/* Recent ledger */}
              <SectionCard title="Recent ledger">
                {user.recentLedger.length === 0 ? (
                  <p className="text-xs text-ink3">No ledger entries.</p>
                ) : (
                  <ul className="flex flex-col">
                    {user.recentLedger.map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-3 border-b border-line2 py-2.5 last:border-b-0"
                      >
                        <span
                          className={
                            l.direction === "debit"
                              ? "font-mono text-[12.5px] font-bold text-tdn tabular-nums"
                              : "font-mono text-[12.5px] font-bold text-tok tabular-nums"
                          }
                        >
                          {l.direction === "debit" ? "−" : "+"}
                          {l.amount} {l.currency}
                        </span>
                        <span className="font-mono text-[11px] text-ink3 tabular-nums">
                          bal {l.balanceAfter}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              {/* Beneficiaries */}
              <SectionCard title="Beneficiaries">
                {user.beneficiaries.length === 0 ? (
                  <p className="text-xs text-ink3">No beneficiaries.</p>
                ) : (
                  <ul className="flex flex-col">
                    {user.beneficiaries.map((b) => (
                      <li
                        key={b.id}
                        className="flex items-center justify-between gap-3 border-b border-line2 py-2.5 last:border-b-0"
                      >
                        <span className="min-w-0 truncate text-[13px] font-bold text-ink">
                          {b.label}
                        </span>
                        <span className="flex-none font-mono text-[11px] text-ink3">
                          {b.type} · {b.verificationStatus}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
