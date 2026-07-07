"use client"

/**
 * BeneficiariesPage — the beneficiary oversight surface (Phase 3, sub-area D).
 * Composition only: a user-id filter drives the (optionally scoped) list read; the
 * four async branches + rows live in `components/admin/beneficiaries/*`. Each row's
 * first-use cooling-off override is the step-up-gated shared `BeneficiaryOverride`.
 */
import { useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BeneficiariesList } from "@/components/admin/beneficiaries/beneficiaries-list"
import { useAdminBeneficiaries } from "@/lib/query/hooks"

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

      <BeneficiariesList
        isLoading={beneficiaries.isLoading}
        isError={beneficiaries.isError}
        isSuccess={beneficiaries.isSuccess}
        items={beneficiaries.data?.items ?? []}
      />
    </div>
  )
}
