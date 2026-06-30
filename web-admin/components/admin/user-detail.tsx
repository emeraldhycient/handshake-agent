"use client"

/**
 * UserDetail — the end-user aggregate drawer (a right-side Sheet). Opened by the
 * users table with a `userId`; fetches the full aggregate via `useEndUserDetail`
 * and renders identity + KYC summary, sensitive operator actions, devices,
 * balances, recent transactions, recent ledger, and beneficiaries.
 *
 * Four async branches on the detail query: loading / error / empty / data. The
 * Sheet is open whenever `userId !== null`; closing clears the selection upward.
 */
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  KycStatusBadge,
  UserStatusBadge,
} from "@/components/admin/user-status-badge"
import { UserActions } from "@/components/admin/user-actions"
import { UserDeviceList } from "@/components/admin/user-device-list"
import { useEndUserDetail } from "@/lib/query/hooks"
import type { UserDetailProps } from "@/types/components"

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
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
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>User detail</SheetTitle>
          <SheetDescription>
            {user?.email ?? userId ?? "Loading user"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4 pt-0">
          {/* ── Loading ──────────────────────────────────────────────────── */}
          {detail.isLoading && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {detail.isError && (
            <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
              <p className="text-sm font-semibold text-destructive">
                Failed to load this user
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Close and try again.
              </p>
            </div>
          )}

          {/* ── Data ─────────────────────────────────────────────────────── */}
          {detail.isSuccess && user && (
            <>
              <Section title="Identity & KYC">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <UserStatusBadge status={user.status} />
                  </dd>
                  <dt className="text-muted-foreground">KYC status</dt>
                  <dd>
                    <KycStatusBadge status={user.kycStatus} />
                  </dd>
                  <dt className="text-muted-foreground">Tier</dt>
                  <dd className="text-foreground">{user.kycTier}</dd>
                  <dt className="text-muted-foreground">SIM swap</dt>
                  <dd className="text-foreground">
                    {user.simSwapDetectedAt
                      ? `Flagged ${formatDate(user.simSwapDetectedAt)}`
                      : "None"}
                  </dd>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="text-foreground tabular-nums">
                    {formatDate(user.createdAt)}
                  </dd>
                </dl>
              </Section>

              <Separator />

              <Section title="Actions">
                <UserActions user={user} />
              </Section>

              <Separator />

              <Section title="Devices">
                <UserDeviceList userId={user.id} devices={user.devices} />
              </Section>

              <Separator />

              <Section title="Balances">
                {user.balances.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No balances.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {user.balances.map((b) => (
                      <li
                        key={`${b.asset}-${b.network}`}
                        className="flex items-center justify-between"
                      >
                        <span className="text-muted-foreground">
                          {b.asset} · {b.network}
                        </span>
                        <span className="font-medium tabular-nums">
                          {b.amount}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Separator />

              <Section title="Recent transactions">
                {user.recentTransactions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No transactions.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {user.recentTransactions.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="text-foreground">{t.type}</span>
                        <span className="text-muted-foreground">
                          {t.status}
                        </span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {formatDate(t.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Separator />

              <Section title="Recent ledger">
                {user.recentLedger.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No ledger entries.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {user.recentLedger.map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="text-muted-foreground">
                          {l.direction === "debit" ? "−" : "+"}
                          {l.amount} {l.currency}
                        </span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          bal {l.balanceAfter}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Separator />

              <Section title="Beneficiaries">
                {user.beneficiaries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No beneficiaries.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {user.beneficiaries.map((b) => (
                      <li
                        key={b.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="text-foreground">{b.label}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {b.type} · {b.verificationStatus}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
