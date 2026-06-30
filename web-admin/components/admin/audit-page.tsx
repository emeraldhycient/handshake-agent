"use client"

/**
 * AuditPage — the hash-chained audit log viewer. Filters (action / subject /
 * date range) drive a keyed useAudit(query). A "Verify chain" button calls
 * POST /admin/audit/verify and renders the { ok, checked, brokenAt } result as a
 * success/danger badge. Four async branches: loading / error / empty / data.
 */
import { useState } from "react"
import { ShieldCheck } from "lucide-react"
import {
  AuditActionSchema,
  type AuditLogQuery,
} from "@handshake-agent/contracts"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { NativeSelect } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { useAudit, useVerifyAuditChain } from "@/lib/query/hooks"

const ACTIONS = AuditActionSchema.options

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
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Audit log
        </h1>
        <div className="flex items-center gap-3">
          {verify.isSuccess && (
            <Badge variant={verify.data.ok ? "default" : "destructive"}>
              {verify.data.ok
                ? `Chain intact · ${verify.data.checked} checked`
                : `Broken at ${verify.data.brokenAt ?? "unknown"}`}
            </Badge>
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
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <form
        className="flex flex-wrap items-end gap-3 rounded-[14px] border border-border bg-card p-4"
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
          <Label htmlFor="filter-subject">Subject</Label>
          <Input
            id="filter-subject"
            className="w-48"
            value={filters.subject}
            onChange={(e) => update("subject", e.target.value)}
            placeholder="Subject id"
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
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {audit.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load the audit log
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {audit.isSuccess && audit.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No audit entries match these filters.
        </p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {audit.isSuccess && audit.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Correlation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.data.items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{entry.action}</Badge>
                  </TableCell>
                  <TableCell className="text-foreground">
                    {entry.actor}
                  </TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">
                    {entry.subject}
                  </TableCell>
                  <TableCell className="max-w-[10rem] truncate font-mono text-xs text-muted-foreground">
                    {entry.correlationId}
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
