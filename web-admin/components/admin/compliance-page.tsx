"use client"

/**
 * CompliancePage — the compliance console (Phase 3, sub-area C). A tab strip over
 * five surfaces:
 *   - Events: the flagged-event queue → ComplianceEventDetail drawer (disposition).
 *   - AML Rules: the engine rules list + create / edit (AmlRuleDialog).
 *   - Travel Rule: qualifying-transfer capture (read-only).
 *   - Reports: SAR/STR filings + draft (AmlReportDraftDialog) + submit.
 *   - Sanctions: immutable screening-run history (read-only); the denylist itself
 *     is edited on the Settings page (Compliance category) — a hint links there.
 *
 * Each data-bearing tab renders its own four async branches (loading / error /
 * empty / data). Write actions are step-up-gated inside their dialogs / drawers.
 *
 * Presentation follows the operator-console design system (§5 primitives, §6.5
 * Sanctions / §6.6 AML / §6.7 Blocked): screening-match cards with a red danger
 * mark, a token-mapped status pill, and design card / table shells.
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
import { Skeleton } from "@/components/ui/skeleton"
import { ComplianceEventDetail } from "@/components/admin/compliance-event-detail"
import { AmlRuleDialog } from "@/components/admin/aml-rule-dialog"
import { ComplianceReportDraftDialog } from "@/components/admin/compliance-report-draft-dialog"
import { ComplianceReportSubmitDialog } from "@/components/admin/compliance-report-submit-dialog"
import {
  useAmlRules,
  useComplianceEvents,
  useComplianceReports,
  useSanctions,
  useTravelRule,
} from "@/lib/query/hooks"
import { cn } from "@/lib/utils"
import { formatCrypto, formatFiat } from "@/lib/format"
import type {
  AmlRule,
  ComplianceReport,
  ComplianceSeverity,
  SanctionsRecordItem,
} from "@handshake-agent/contracts"

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"]

const TABS = [
  "Events",
  "AML Rules",
  "Travel Rule",
  "Reports",
  "Sanctions",
] as const

type Tab = (typeof TABS)[number]

// ── Status → token pill maps (§5 status→token map) ────────────────────────────────
const SEVERITY_VARIANT: Record<ComplianceSeverity, BadgeVariant> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "neutral",
}

const VERDICT_VARIANT: Record<SanctionsRecordItem["verdict"], BadgeVariant> = {
  hit: "danger",
  inconclusive: "warn",
  clear: "success",
}

const REPORT_VARIANT: Record<ComplianceReport["status"], BadgeVariant> = {
  submitted: "success",
  closed: "success",
  rejected: "danger",
  draft: "neutral",
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

// ── Shared shells ─────────────────────────────────────────────────────────────────

/** The design table shell: rounded card, hidden overflow, card2 header row. */
function TableCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <Table>{children}</Table>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl" />
    </div>
  )
}

function ErrorPanel({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-sdn bg-sdn/40 p-5 text-center">
      <p className="text-sm font-bold text-tdn">Failed to load {what}</p>
      <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink2">{children}</p>
}

// ── Events tab ─────────────────────────────────────────────────────────────────

function EventsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const events = useComplianceEvents({})

  if (events.isLoading) return <LoadingRows />
  if (events.isError) return <ErrorPanel what="compliance events" />
  if (events.isSuccess && events.data.items.length === 0) {
    return <EmptyNote>No flagged events.</EmptyNote>
  }
  if (!events.isSuccess) return null

  return (
    <TableCard>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.data.items.map((event) => (
          <TableRow
            key={event.id}
            role="button"
            tabIndex={0}
            aria-label={`Review event ${event.eventType}`}
            className="cursor-pointer focus-visible:bg-hov focus-visible:outline-none"
            onClick={() => onOpen(event.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onOpen(event.id)
              }
            }}
          >
            <TableCell className="font-semibold text-ink">
              {event.eventType}
            </TableCell>
            <TableCell>
              <Badge variant={SEVERITY_VARIANT[event.severity]}>
                {event.severity}
              </Badge>
            </TableCell>
            <TableCell className="text-ink2">{event.status}</TableCell>
            <TableCell className="text-ink2">
              {event.screeningProvider}
            </TableCell>
            <TableCell className="text-ink2 tabular-nums">
              {formatDate(event.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableCard>
  )
}

// ── AML Rules tab (§6.6 risk-rule layout) ─────────────────────────────────────────

function AmlRulesTab({ onEdit }: { onEdit: (rule: AmlRule) => void }) {
  const rules = useAmlRules()

  if (rules.isLoading) return <LoadingRows />
  if (rules.isError) return <ErrorPanel what="AML rules" />
  if (rules.isSuccess && rules.data.rules.length === 0) {
    return <EmptyNote>No AML rules.</EmptyNote>
  }
  if (!rules.isSuccess) return null

  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Risk rules{" "}
        <span className="font-semibold text-ink3">
          · thresholds are maker-checker
        </span>
      </div>
      <ul>
        {rules.data.rules.map((rule) => (
          <li
            key={rule.id}
            className="flex items-center gap-3 border-b border-line2 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs font-bold text-ink">
                {rule.ruleKey}
              </div>
              <div className="truncate text-[11px] text-ink3">
                {rule.name} · {rule.ruleType}
              </div>
            </div>
            <Badge variant={rule.action === "block" ? "danger" : "warn"}>
              {rule.action}
            </Badge>
            {rule.enabled ? (
              <Badge variant="success">on</Badge>
            ) : (
              <Badge variant="neutral">off</Badge>
            )}
            <span className="font-mono text-xs font-bold text-ink2 tabular-nums">
              v{rule.version}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={`Edit rule ${rule.ruleKey}`}
              onClick={() => onEdit(rule)}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 20h4l10-10-4-4L4 16z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Travel Rule tab ────────────────────────────────────────────────────────────

function TravelRuleTab() {
  const travel = useTravelRule()

  if (travel.isLoading) return <LoadingRows />
  if (travel.isError) return <ErrorPanel what="Travel Rule records" />
  if (travel.isSuccess && travel.data.items.length === 0) {
    return <EmptyNote>No Travel Rule records.</EmptyNote>
  }
  if (!travel.isSuccess) return null

  return (
    <TableCard>
      <TableHeader>
        <TableRow>
          <TableHead>Transaction</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Fiat</TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Reported</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {travel.data.items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-mono text-xs text-ink2">
              {item.transactionId.slice(0, 8)}…
            </TableCell>
            <TableCell className="text-right font-mono text-ink tabular-nums">
              {formatCrypto(item.amount, item.asset)}
            </TableCell>
            {/* amountFiat carries no currency on the contract — reported in the
                platform fiat (NGN). If TravelRuleItem gains a fiatCurrency, thread
                it here instead of the literal. */}
            <TableCell className="text-right text-ink2 tabular-nums">
              {formatFiat(item.amountFiat, "NGN")}
            </TableCell>
            <TableCell className="text-ink2">{item.triggeringFactor}</TableCell>
            <TableCell className="text-ink2 tabular-nums">
              {formatDate(item.reportedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableCard>
  )
}

// ── Reports tab ────────────────────────────────────────────────────────────────

function ReportsTab({
  onSubmit,
}: {
  onSubmit: (report: ComplianceReport) => void
}) {
  const reports = useComplianceReports()

  if (reports.isLoading) return <LoadingRows />
  if (reports.isError) return <ErrorPanel what="compliance reports" />
  if (reports.isSuccess && reports.data.items.length === 0) {
    return <EmptyNote>No reports.</EmptyNote>
  }
  if (!reports.isSuccess) return null

  return (
    <TableCard>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Events</TableHead>
          <TableHead>Submitted</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {reports.data.items.map((report) => (
          <TableRow key={report.id}>
            <TableCell className="font-semibold text-ink">
              {report.reportType.toUpperCase()}
            </TableCell>
            <TableCell>
              <Badge variant={REPORT_VARIANT[report.status]}>
                {report.status}
              </Badge>
            </TableCell>
            <TableCell className="text-right text-ink2 tabular-nums">
              {report.relatedEvents.length}
            </TableCell>
            <TableCell className="text-ink2 tabular-nums">
              {formatDate(report.submittedAt)}
            </TableCell>
            <TableCell className="text-right">
              {report.status === "draft" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSubmit(report)}
                >
                  Submit
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableCard>
  )
}

// ── Sanctions tab (§6.5 screening-match cards) ────────────────────────────────────

/** A screening-run row rendered as the design's match card (red danger mark). */
function SanctionsCard({ record }: { record: SanctionsRecordItem }) {
  const isHit = record.verdict === "hit"
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4",
        isHit ? "border-sdn" : "border-line"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 flex-none items-center justify-center rounded-xl",
            isHit ? "bg-sdn text-tdn" : "bg-card2 text-ink3"
          )}
          aria-hidden="true"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 4l9 16H3zM12 10v4M12 17h.01"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-bold text-ink">
            {record.counterpartyId}
          </div>
          <div className="text-[11.5px] text-ink2">
            Screened via <b className="font-bold">{record.provider}</b> ·{" "}
            {record.screeningType}
          </div>
        </div>
        <Badge variant={VERDICT_VARIANT[record.verdict]}>
          {record.verdict}
        </Badge>
        <span className="text-[11.5px] whitespace-nowrap text-ink3 tabular-nums">
          {formatDate(record.createdAt)}
        </span>
      </div>
    </div>
  )
}

function SanctionsTab() {
  const sanctions = useSanctions()

  return (
    <div className="flex flex-col gap-3">
      <div
        role="note"
        className="rounded-2xl bg-sif px-4 py-3 text-[13px] text-tif"
      >
        The sanctions denylist is edited on the{" "}
        <a href="/settings" className="font-bold underline underline-offset-2">
          Settings page
        </a>{" "}
        (Compliance category). This is the immutable screening-run history.
      </div>

      {sanctions.isLoading && <LoadingRows />}
      {sanctions.isError && <ErrorPanel what="sanctions records" />}
      {sanctions.isSuccess && sanctions.data.items.length === 0 && (
        <EmptyNote>No sanctions records.</EmptyNote>
      )}
      {sanctions.isSuccess && sanctions.data.items.length > 0 && (
        <div className="flex flex-col gap-3">
          {sanctions.data.items.map((record) => (
            <SanctionsCard key={record.id} record={record} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function CompliancePage() {
  const [active, setActive] = useState<Tab>("Events")
  const [eventId, setEventId] = useState<string | null>(null)
  const [editingRule, setEditingRule] = useState<AmlRule | null>(null)
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const [submittingReport, setSubmittingReport] =
    useState<ComplianceReport | null>(null)
  const [submitOpen, setSubmitOpen] = useState(false)

  function openNewRule() {
    setEditingRule(null)
    setRuleDialogOpen(true)
  }

  function openEditRule(rule: AmlRule) {
    setEditingRule(rule)
    setRuleDialogOpen(true)
  }

  function openSubmit(report: ComplianceReport) {
    setSubmittingReport(report)
    setSubmitOpen(true)
  }

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-5 overflow-y-auto px-8 py-7">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
            Compliance
          </h1>
          <p className="mt-1 text-[13.5px] text-ink2">
            Events, AML rules, Travel Rule records, SAR/STR filings and
            screening history.
          </p>
        </div>
        {active === "AML Rules" && (
          <Button size="sm" onClick={openNewRule}>
            + New rule
          </Button>
        )}
        {active === "Reports" && (
          <Button size="sm" onClick={() => setDraftOpen(true)}>
            + Draft report
          </Button>
        )}
      </div>

      {/* ── Tab strip (§5 pill tabs) ─────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Compliance surfaces"
        className="flex flex-wrap gap-2"
      >
        {TABS.map((tab) => {
          const selected = tab === active
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab)}
              className={cn(
                "h-9 rounded-[10px] border px-4 text-[13px] font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                selected
                  ? "border-btn-dark bg-btn-dark text-white"
                  : "border-line bg-card text-ink2 hover:bg-hov"
              )}
            >
              {tab}
            </button>
          )
        })}
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      {active === "Events" && <EventsTab onOpen={setEventId} />}
      {active === "AML Rules" && <AmlRulesTab onEdit={openEditRule} />}
      {active === "Travel Rule" && <TravelRuleTab />}
      {active === "Reports" && <ReportsTab onSubmit={openSubmit} />}
      {active === "Sanctions" && <SanctionsTab />}

      <ComplianceEventDetail
        eventId={eventId}
        onOpenChange={(open) => {
          if (!open) setEventId(null)
        }}
      />
      <AmlRuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        rule={editingRule}
      />
      <ComplianceReportDraftDialog
        open={draftOpen}
        onOpenChange={setDraftOpen}
      />
      <ComplianceReportSubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        report={submittingReport}
      />
    </div>
  )
}
