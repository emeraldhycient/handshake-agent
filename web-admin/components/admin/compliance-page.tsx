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
import type { AmlRule, ComplianceReport } from "@handshake-agent/contracts"

const TABS = [
  "Events",
  "AML Rules",
  "Travel Rule",
  "Reports",
  "Sanctions",
] as const

type Tab = (typeof TABS)[number]

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  )
}

function ErrorPanel({ what }: { what: string }) {
  return (
    <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
      <p className="text-sm font-semibold text-destructive">
        Failed to load {what}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Please refresh the page.
      </p>
    </div>
  )
}

// ─── Events tab ─────────────────────────────────────────────────────────────────

function EventsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const events = useComplianceEvents({})

  if (events.isLoading) return <LoadingRows />
  if (events.isError) return <ErrorPanel what="compliance events" />
  if (events.isSuccess && events.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No flagged events.</p>
  }
  if (!events.isSuccess) return null

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card">
      <Table>
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
              className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
              onClick={() => onOpen(event.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onOpen(event.id)
                }
              }}
            >
              <TableCell className="font-medium text-foreground">
                {event.eventType}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    event.severity === "critical" || event.severity === "high"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {event.severity}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {event.status}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {event.screeningProvider}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {formatDate(event.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── AML Rules tab ──────────────────────────────────────────────────────────────

function AmlRulesTab({ onEdit }: { onEdit: (rule: AmlRule) => void }) {
  const rules = useAmlRules()

  if (rules.isLoading) return <LoadingRows />
  if (rules.isError) return <ErrorPanel what="AML rules" />
  if (rules.isSuccess && rules.data.rules.length === 0) {
    return <p className="text-sm text-muted-foreground">No AML rules.</p>
  }
  if (!rules.isSuccess) return null

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead>Ver</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.data.rules.map((rule) => (
            <TableRow key={rule.id}>
              <TableCell className="font-mono text-xs text-foreground">
                {rule.ruleKey}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {rule.ruleType}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    rule.action === "block" ? "destructive" : "secondary"
                  }
                >
                  {rule.action}
                </Badge>
              </TableCell>
              <TableCell>
                {rule.enabled ? (
                  <Badge variant="default">on</Badge>
                ) : (
                  <Badge variant="outline">off</Badge>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {rule.version}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEdit(rule)}
                >
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Travel Rule tab ────────────────────────────────────────────────────────────

function TravelRuleTab() {
  const travel = useTravelRule()

  if (travel.isLoading) return <LoadingRows />
  if (travel.isError) return <ErrorPanel what="Travel Rule records" />
  if (travel.isSuccess && travel.data.items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No Travel Rule records.</p>
    )
  }
  if (!travel.isSuccess) return null

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card">
      <Table>
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
              <TableCell className="font-mono text-xs text-muted-foreground">
                {item.transactionId.slice(0, 8)}…
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {item.amount} {item.asset}
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {item.amountFiat}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {item.triggeringFactor}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {formatDate(item.reportedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Reports tab ────────────────────────────────────────────────────────────────

function ReportsTab({
  onSubmit,
}: {
  onSubmit: (report: ComplianceReport) => void
}) {
  const reports = useComplianceReports()

  if (reports.isLoading) return <LoadingRows />
  if (reports.isError) return <ErrorPanel what="compliance reports" />
  if (reports.isSuccess && reports.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No reports.</p>
  }
  if (!reports.isSuccess) return null

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Events</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.data.items.map((report) => (
            <TableRow key={report.id}>
              <TableCell className="font-medium text-foreground">
                {report.reportType.toUpperCase()}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    report.status === "rejected"
                      ? "destructive"
                      : report.status === "submitted"
                        ? "default"
                        : "secondary"
                  }
                >
                  {report.status}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {report.relatedEvents.length}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
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
      </Table>
    </div>
  )
}

// ─── Sanctions tab ──────────────────────────────────────────────────────────────

function SanctionsTab() {
  const sanctions = useSanctions()

  return (
    <div className="flex flex-col gap-3">
      <div
        role="note"
        className="rounded-[14px] border border-info/30 bg-info/5 px-4 py-3 text-sm text-info-foreground"
      >
        The sanctions denylist is edited on the{" "}
        <a href="/settings" className="font-medium underline">
          Settings page
        </a>{" "}
        (Compliance category). This is the immutable screening-run history.
      </div>

      {sanctions.isLoading && <LoadingRows />}
      {sanctions.isError && <ErrorPanel what="sanctions records" />}
      {sanctions.isSuccess && sanctions.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No sanctions records.</p>
      )}
      {sanctions.isSuccess && sanctions.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Counterparty</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Screened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sanctions.data.items.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {record.counterpartyId.slice(0, 12)}…
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        record.verdict === "hit"
                          ? "destructive"
                          : record.verdict === "inconclusive"
                            ? "secondary"
                            : "default"
                      }
                    >
                      {record.verdict}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {record.provider}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {record.screeningType}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDate(record.createdAt)}
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

// ─── Page ───────────────────────────────────────────────────────────────────────

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
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Compliance
        </h1>
        {active === "AML Rules" && (
          <Button size="sm" onClick={openNewRule}>
            New rule
          </Button>
        )}
        {active === "Reports" && (
          <Button size="sm" onClick={() => setDraftOpen(true)}>
            Draft report
          </Button>
        )}
      </div>

      {/* ── Tab strip ────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Compliance surfaces"
        className="flex flex-wrap gap-1 border-b border-border"
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
                "-mb-px rounded-t-md border-b-2 px-3.5 py-2 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
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
