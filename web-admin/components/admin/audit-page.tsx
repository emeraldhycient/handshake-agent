"use client"

/**
 * AuditPage — the hash-chained audit log viewer. Filters (action / subject /
 * date range) drive a keyed useAudit(query). A "Verify chain" button calls
 * POST /admin/audit/verify and renders the { ok, checked, brokenAt } result as a
 * "Hash-chain verified" (success) / broken (danger) pill. Four async branches:
 * loading / error / empty / data.
 *
 * Presentation follows the operator-console design (§6.10 Audit): a verified
 * pill + Export in the header, an action/subject/date filter row, and a table of
 * Actor (name + correlation) · Action (mono chip) · Target (mono) ·
 * Before → after (strike-red → green) · Reason · Time. Immutable: nothing is
 * ever hard-deleted.
 */
import { useState } from "react"
import { Download, ShieldCheck, ShieldX } from "lucide-react"
import {
  AuditActionSchema,
  type AuditAction,
  type AuditLogEntry,
  type AuditLogQuery,
} from "@handshake-agent/contracts"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { useAudit, useVerifyAuditChain } from "@/lib/query/hooks"

const ACTIONS = AuditActionSchema.options

// Grid column template shared by the table header and every row so the two stay
// aligned (Actor · Action · Target · Before→after · Reason · Time).
const GRID_COLS = "grid-cols-[1.1fr_1fr_1.4fr_1.6fr_1.2fr_0.9fr]"

// Maps an audit action to a status-pill token pair for its mono chip. Money /
// state mutations read danger-adjacent, reviews/config read info/warn, the
// happy execute path reads success — semantics only, never hex.
const ACTION_CHIP: Record<AuditAction, string> = {
  propose: "bg-card2 text-ink2",
  confirm: "bg-sif text-tif",
  authorize: "bg-swn text-twn",
  execute: "bg-sok text-tok",
  admin_update: "bg-sif text-tif",
  admin_review: "bg-sif text-tif",
  admin_override: "bg-swn text-twn",
  sanctions_hit: "bg-sdn text-tdn",
  aml_flag: "bg-sdn text-tdn",
  rule_violation: "bg-sdn text-tdn",
  kyc_state_change: "bg-sif text-tif",
  beneficiary_add: "bg-sok text-tok",
  beneficiary_remove: "bg-sdn text-tdn",
  device_bind: "bg-sif text-tif",
  pin_set: "bg-sok text-tok",
  pin_reset: "bg-swn text-twn",
  session_create: "bg-card2 text-ink2",
  session_revoke: "bg-swn text-twn",
  step_up_challenge: "bg-swn text-twn",
  step_up_passed: "bg-sok text-tok",
  config_change: "bg-swn text-twn",
  audit_chain_check: "bg-card2 text-ink2",
}

// Local-only filter form state. Empty strings are stripped before querying so a
// blank filter is omitted entirely (matches the optional query schema).
interface FilterState {
  action: string
  subject: string
  from: string
  to: string
}

function toQuery(filters: FilterState): AuditLogQuery {
  return {
    ...(filters.action
      ? { action: filters.action as AuditLogQuery["action"] }
      : {}),
    ...(filters.subject ? { subject: filters.subject } : {}),
    ...(filters.from ? { from: new Date(filters.from).toISOString() } : {}),
    ...(filters.to ? { to: new Date(filters.to).toISOString() } : {}),
    limit: 50,
  }
}

// Renders an audit before/after snapshot compactly. Objects collapse to a
// single-line JSON summary; primitives stringify; null/undefined become an
// em-dash so an empty side never renders a bare arrow.
function formatSnapshot(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "object") {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

// The operator reason lives in `details.reason` when present; otherwise there is
// nothing to show.
function reasonOf(entry: AuditLogEntry): string {
  const reason = (entry.details as Record<string, unknown>).reason
  return typeof reason === "string" && reason.length > 0 ? reason : "—"
}

export function AuditPage() {
  const [filters, setFilters] = useState<FilterState>({
    action: "",
    subject: "",
    from: "",
    to: "",
  })
  const [applied, setApplied] = useState<AuditLogQuery>({ limit: 50 })

  const audit = useAudit(applied)
  const verify = useVerifyAuditChain()

  function update<K extends keyof FilterState>(key: K, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-1 flex-col gap-4 overflow-y-auto px-6 py-6 sm:px-8">
      {/* ── Header: title + subtitle + verify pill + verify/export actions ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">
            Audit log
          </h1>
          <p className="mt-1 text-[13.5px] text-ink2">
            Immutable record of every mutating action. Never editable, nothing
            hard-deleted.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {verify.isSuccess && (
            <span
              role="status"
              className={
                verify.data.ok
                  ? "inline-flex h-[34px] items-center gap-2 rounded-full bg-sok px-3 text-[11.5px] font-bold text-tok"
                  : "inline-flex h-[34px] items-center gap-2 rounded-full bg-sdn px-3 text-[11.5px] font-bold text-tdn"
              }
            >
              {verify.data.ok ? (
                <ShieldCheck aria-hidden="true" className="size-3.5" />
              ) : (
                <ShieldX aria-hidden="true" className="size-3.5" />
              )}
              {verify.data.ok
                ? `Hash-chain verified · ${verify.data.checked}`
                : `Chain broken at ${verify.data.brokenAt ?? "unknown"}`}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
            aria-busy={verify.isPending}
          >
            <ShieldCheck aria-hidden="true" />
            {verify.isPending ? "Verifying…" : "Verify chain"}
          </Button>
          <Button size="sm" variant="outline" disabled>
            <Download aria-hidden="true" />
            Export
          </Button>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <form
        className="flex flex-wrap items-end gap-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          setApplied(toQuery(filters))
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-action">Action</Label>
          <NativeSelect
            id="filter-action"
            className="w-48"
            value={filters.action}
            onChange={(e) => update("action", e.target.value)}
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-subject">Target</Label>
          <Input
            id="filter-subject"
            className="w-56"
            value={filters.subject}
            onChange={(e) => update("subject", e.target.value)}
            placeholder="actor, target, action…"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-from">From</Label>
          <Input
            id="filter-from"
            type="datetime-local"
            value={filters.from}
            onChange={(e) => update("from", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-to">To</Label>
          <Input
            id="filter-to"
            type="datetime-local"
            value={filters.to}
            onChange={(e) => update("to", e.target.value)}
          />
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
      </form>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {audit.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-12 w-full rounded-[14px]" />
          <Skeleton className="h-12 w-full rounded-[14px]" />
          <Skeleton className="h-12 w-full rounded-[14px]" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {audit.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
          <p className="text-sm font-semibold text-tdn">
            Failed to load the audit log
          </p>
          <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {audit.isSuccess && audit.data.items.length === 0 && (
        <div className="rounded-[16px] border border-line bg-card p-12 text-center">
          <p className="text-sm font-bold text-ink">No audit entries</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            No records match these filters.
          </p>
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {audit.isSuccess && audit.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[16px] border border-line bg-card">
          {/* Header row */}
          <div
            className={`grid ${GRID_COLS} gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase`}
          >
            <div>Actor</div>
            <div>Action</div>
            <div>Target</div>
            <div>Before → after</div>
            <div>Reason</div>
            <div>Time</div>
          </div>
          {/* Body rows */}
          {audit.data.items.map((entry) => (
            <div
              key={entry.id}
              className={`grid ${GRID_COLS} items-center gap-3 border-b border-line2 px-[18px] py-3 last:border-b-0`}
            >
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-bold text-ink">
                  {entry.actor}
                </div>
                <div className="truncate font-mono text-[10.5px] text-ink3">
                  {entry.correlationId}
                </div>
              </div>
              <div>
                <span
                  className={`inline-flex rounded-[6px] px-2 py-0.5 font-mono text-[11px] font-bold ${ACTION_CHIP[entry.action]}`}
                >
                  {entry.action}
                </span>
              </div>
              <div className="truncate font-mono text-[11.5px] text-ink2">
                {entry.subject}
              </div>
              <div className="truncate text-[11.5px]">
                <span className="font-mono text-tdn line-through opacity-75">
                  {formatSnapshot(entry.before)}
                </span>{" "}
                <span className="font-mono font-bold text-tok">
                  → {formatSnapshot(entry.after)}
                </span>
              </div>
              <div className="truncate text-[11.5px] text-ink2">
                {reasonOf(entry)}
              </div>
              <div className="font-mono text-[11px] text-ink3 tabular-nums">
                {new Date(entry.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
