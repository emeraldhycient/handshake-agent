"use client"

import Link from "next/link"

import { FeatureCard } from "@/components/admin/feature-card"
import { Skeleton } from "@/components/ui/skeleton"
import { useApprovalsInbox } from "@/lib/query/hooks"
import {
  APPROVAL_KIND_LABEL,
  APPROVALS_PANEL_LIMIT,
} from "@/constants/dashboard"
import type { ChangeRequest } from "@handshake-agent/contracts"

/**
 * Approvals-awaiting-me teaser — wired to `useApprovalsInbox`. The header carries the
 * awaiting-me count badge; the body lists the first few pending requests a different
 * admin raised. Four async branches (loading / error / empty / data). Rows link to the
 * full /approvals inbox — the dashboard never approves (that lives on the Approvals page).
 */
export function ApprovalsCard() {
  const inbox = useApprovalsInbox()
  const awaiting = inbox.data?.awaitingMe ?? []
  const count = inbox.data?.counts.awaitingMe ?? awaiting.length
  const rows = awaiting.slice(0, APPROVALS_PANEL_LIMIT)

  return (
    <FeatureCard>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink">
            Approvals awaiting me
          </span>
          {inbox.isSuccess && count > 0 && (
            <span className="rounded-full bg-swn px-2 py-0.5 text-[10.5px] font-bold text-twn tabular-nums">
              {count}
            </span>
          )}
        </div>
        <Link
          href="/approvals"
          className="text-xs font-bold text-tif outline-none hover:underline focus-visible:underline"
        >
          Open inbox →
        </Link>
      </div>

      {inbox.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[38px] rounded-[8px]" />
          ))}
        </div>
      ) : inbox.isError ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          Approvals inbox unavailable.
        </div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-ink3">
          Nothing awaiting your approval.
        </div>
      ) : (
        rows.map((cr: ChangeRequest) => (
          <Link
            key={cr.id}
            href="/approvals"
            className="flex w-full items-center gap-[11px] border-b border-line2 py-2.5 text-left last:border-0 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span
              aria-hidden
              className="size-2 flex-none rounded-full bg-brand-amber"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink">
                {APPROVAL_KIND_LABEL[cr.kind]} · {cr.resource}
              </div>
              <div className="text-[10.5px] text-ink3">
                by {cr.requestedByEmail ?? cr.requestedByAdminId}
              </div>
            </div>
            <span className="flex-none rounded-full bg-swn px-2 py-0.5 text-[10.5px] font-bold text-twn">
              Pending
            </span>
          </Link>
        ))
      )}
    </FeatureCard>
  )
}
