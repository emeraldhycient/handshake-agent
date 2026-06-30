"use client"

/**
 * BeneficiariesPage — the beneficiary oversight surface (Phase 3, sub-area D).
 * Lists saved payout destinations (optionally scoped to a user id) and exposes the
 * first-use cooling-off override (IDN-08) per beneficiary, shown only while the
 * lock is active. The override is step-up-gated inside `BeneficiaryOverride`.
 *
 * Four async branches on the list query: loading / error / empty / data.
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { BeneficiaryOverride } from "@/components/admin/beneficiary-override"
import { useAdminBeneficiaries } from "@/lib/query/hooks"

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

export function BeneficiariesPage() {
  const [userId, setUserId] = useState("")
  const beneficiaries = useAdminBeneficiaries(
    userId.trim() ? userId.trim() : undefined
  )

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Beneficiaries
        </h1>
      </div>

      {/* ── Filter ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-border bg-card p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="beneficiary-user">User id</Label>
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
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {beneficiaries.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load beneficiaries
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {beneficiaries.isSuccess && beneficiaries.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No beneficiaries.</p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {beneficiaries.isSuccess && beneficiaries.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead>Cooling-off</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {beneficiaries.data.items.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium text-foreground">
                    {b.label}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.type}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.verificationStatus}
                  </TableCell>
                  <TableCell>
                    {b.coolingOffActive ? (
                      <Badge variant="secondary">
                        until {formatDate(b.firstUseLockedUntil)}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        cleared
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <BeneficiaryOverride beneficiary={b} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
