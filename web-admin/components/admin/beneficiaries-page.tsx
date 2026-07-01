"use client"

/**
 * BeneficiariesPage — the beneficiary oversight surface (Phase 3, sub-area D).
 * Lists saved payout destinations (optionally scoped to a user id) and exposes the
 * first-use cooling-off override (IDN-08) per beneficiary, shown only while the
 * lock is active. The override is step-up-gated inside `BeneficiaryOverride`.
 *
 * Four async branches on the list query: loading / error / empty / data.
 * Presentation follows the operator-console design (§6.3 UserDetail Beneficiaries):
 * a single card of rows — icon tile · name + mono detail · name-enquiry pill · action.
 */
import { useState } from "react"
import { Landmark, Wallet } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { BeneficiaryOverride } from "@/components/admin/beneficiary-override"
import { useAdminBeneficiaries } from "@/lib/query/hooks"
import type { AdminBeneficiary } from "@handshake-agent/contracts"

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

/** Human label for the beneficiary type (bank vs. on-chain address). */
function typeLabel(type: AdminBeneficiary["type"]): string {
  return type === "bank_account" ? "Bank account" : "USDT address"
}

/**
 * Name-enquiry / verification status → status-pill variant. `verified` reads as
 * a name match (success); an unverified/failed enquiry is a warning.
 */
function verificationVariant(
  status: string
): "success" | "warn" | "danger" | "neutral" {
  const s = status.toLowerCase()
  if (s === "verified") return "success"
  if (s === "failed" || s === "rejected") return "danger"
  if (s === "pending" || s === "unverified") return "warn"
  return "neutral"
}

export function BeneficiariesPage() {
  const [userId, setUserId] = useState("")
  const beneficiaries = useAdminBeneficiaries(
    userId.trim() ? userId.trim() : undefined
  )

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-1 flex-col gap-4 overflow-y-auto px-[30px] py-[26px]">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="mb-1">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Beneficiaries
        </h1>
        <p className="mt-1 text-[13.5px] text-ink2">
          Saved payout destinations with name-enquiry status and the first-use
          cooling-off override.
        </p>
      </header>

      {/* ── Filter ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-card p-5">
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="beneficiary-user"
            className="text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase"
          >
            User id
          </Label>
          <Input
            id="beneficiary-user"
            className="w-72"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Filter by user UUID (optional)"
          />
        </div>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {beneficiaries.isLoading && (
        <div
          className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-5"
          aria-busy="true"
        >
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {beneficiaries.isError && (
        <div className="rounded-2xl border border-line bg-sdn p-5 text-center">
          <p className="text-sm font-bold text-tdn">
            Failed to load beneficiaries
          </p>
          <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {beneficiaries.isSuccess && beneficiaries.data.items.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-card px-5 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-card2 text-ink3">
            <Wallet aria-hidden="true" className="size-5" />
          </span>
          <p className="text-sm font-bold text-ink">No beneficiaries</p>
          <p className="text-[12.5px] text-ink3">
            No saved payout destinations for this scope.
          </p>
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {beneficiaries.isSuccess && beneficiaries.data.items.length > 0 && (
        <div className="rounded-2xl border border-line bg-card px-5">
          {beneficiaries.data.items.map((b, i) => {
            const Icon = b.type === "bank_account" ? Landmark : Wallet
            return (
              <div
                key={b.id}
                className={
                  "flex items-center gap-3.5 py-4" +
                  (i < beneficiaries.data.items.length - 1
                    ? " border-b border-line2"
                    : "")
                }
              >
                <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-card2 text-ink2">
                  <Icon aria-hidden="true" className="size-[17px]" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-ink">
                    {b.label}
                  </div>
                  <div className="truncate font-mono text-[11.5px] text-ink3">
                    {typeLabel(b.type)}
                  </div>
                </div>

                <Badge variant={verificationVariant(b.verificationStatus)}>
                  {b.verificationStatus}
                </Badge>

                {b.coolingOffActive ? (
                  <Badge variant="warn">
                    Cooling-off until {formatDate(b.firstUseLockedUntil)}
                  </Badge>
                ) : (
                  <span className="text-[11.5px] font-semibold text-ink3">
                    Cleared
                  </span>
                )}

                <BeneficiaryOverride beneficiary={b} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
