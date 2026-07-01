"use client"

/**
 * AmlPage — the AML / risk screen, reproduced pixel-for-pixel from
 * `docs/design-ref/screens/Aml.html` (SPEC §6.6). A `1.2fr 1fr` grid:
 *
 *   - LEFT  · Risk rules — the admin-tunable engine thresholds (real AML rules via
 *     `useAmlRules`), one row each with a name, description, a mono/tnum threshold
 *     (composed from the rule's typed `parameters`), and an edit pencil. The card
 *     title carries the "· thresholds are maker-checker" suffix — editing a
 *     threshold is a dual-control change (never moves money; thresholds only
 *     annotate the engine's rule set, root §3.1). The pencil opens the shared
 *     MakerCheckerModal (write path is Phase 7 — left as a no-op flow).
 *   - RIGHT top · Open cases — the still-open flagged compliance cases (real
 *     flagged-event queue via `useComplianceEvents`, filtered to open statuses),
 *     each a severity dot + title + meta + status pill. Every row is now a
 *     button that opens a read-only case-detail dialog (Phase 6b drill-in) —
 *     `useComplianceEvent(id)` surfaces the raw screening payload + the
 *     disposition note. A "Draft SAR/CTR" link opens the shared ReasonModal
 *     (Phase 7 write).
 *   - RIGHT bottom · Travel Rule records — a read-only summary of qualifying
 *     transfers captured (real count via `useTravelRule`); and a read-only
 *     Compliance reports card listing the SAR/STR filings (`useComplianceReports`,
 *     Phase 6b).
 *
 * READ-WIRED (Phase 6a/6b): the display consts are replaced with the existing read
 * hooks. Nothing here moves money (§3.1). Each card region has four async
 * branches — loading skeleton / error (inline, retryable) / empty / data. The
 * write affordances (edit-threshold, Draft SAR/CTR) keep their design flow-modal
 * behaviour untouched — those are Phase 7.
 *
 * The `{{ c.dot }}` / `{{ c.stBg }}` / `{{ c.stFg }}` inline styles from the markup map
 * onto the design's semantic status tokens (§5 status→token map): the leading dot's
 * surface + the status pill's `s*`/`t*` pair. Colour is never the sole signal — every
 * pill carries its label.
 */
import { useMemo, useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { ReasonModal, MakerCheckerModal } from "@/components/admin/flows"
import { cn } from "@/lib/utils"
import {
  useAmlRules,
  useComplianceEvent,
  useComplianceEvents,
  useComplianceReports,
  useTravelRule,
} from "@/lib/query/hooks"
import type {
  AmlRule,
  ComplianceEventItem,
  ComplianceEventStatus,
  ComplianceReport,
} from "@handshake-agent/contracts"

// ── Risk rules (LEFT) ────────────────────────────────────────────────────────────

/**
 * Compose the mono/tnum threshold string the design shows from the rule's typed
 * `parameters` record (the contract models parameters, not a single free-text
 * threshold — see shapeGaps). Renders `key value` pairs; an em dash when empty.
 */
function thresholdFromParameters(parameters: AmlRule["parameters"]): string {
  const entries = Object.entries(parameters)
  if (entries.length === 0) return "—"
  return entries
    .map(([key, value]) => `${key.replace(/_/g, " ")} ${String(value)}`)
    .join(" · ")
}

// ── Open cases (RIGHT top) — the `{{ c.* }}` inline styles map onto the semantic
// status tokens (§5 status→token map).

// Status → { dot surface, pill label, pill surface + text }. Flagged reads danger,
// under-review reads warning — mirroring the design's `stMeta`. The contract's
// ComplianceEventStatus has no `escalated`; the terminal statuses (approved/blocked/
// dismissed) are not "open" so they never reach this map (filtered out below).
const CASE_STATUS_META: Record<
  ComplianceEventStatus,
  { dot: string; label: string; pillBg: string; pillFg: string }
> = {
  flagged: {
    dot: "bg-tdn",
    label: "Flagged",
    pillBg: "bg-sdn",
    pillFg: "text-tdn",
  },
  under_review: {
    dot: "bg-twn",
    label: "In review",
    pillBg: "bg-swn",
    pillFg: "text-twn",
  },
  approved: {
    dot: "bg-tok",
    label: "Approved",
    pillBg: "bg-sok",
    pillFg: "text-tok",
  },
  blocked: {
    dot: "bg-tif",
    label: "Blocked",
    pillBg: "bg-sif",
    pillFg: "text-tif",
  },
  dismissed: {
    dot: "bg-ink3",
    label: "Dismissed",
    pillBg: "bg-card2",
    pillFg: "text-ink2",
  },
}

/** The still-open statuses the "Open cases" queue surfaces (design intent). */
const OPEN_STATUSES: readonly ComplianceEventStatus[] = [
  "flagged",
  "under_review",
]

/** Compose the human title the design shows (`eventType` humanised + rule/hit). */
function caseTitle(event: ComplianceEventItem): string {
  const type = event.eventType.replace(/[._]/g, " ")
  return event.ruleOrHit ? `${type} — ${event.ruleOrHit}` : type
}

/** Compose the meta line (severity · user · captured-at) from the DTO fields. */
function caseMeta(event: ComplianceEventItem): string {
  const parts = [
    `${event.severity} severity`,
    `user ${event.userId.slice(0, 8)}`,
  ]
  if (event.transactionId) parts.push(`txn ${event.transactionId.slice(0, 8)}`)
  parts.push(new Date(event.createdAt).toLocaleDateString())
  return parts.join(" · ")
}

// ── Small icons ─────────────────────────────────────────────────────────────────────

/** The edit pencil on a risk-rule row (design line 7). */
function EditPencilIcon() {
  return (
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
  )
}

// ── Cards ─────────────────────────────────────────────────────────────────────────

/** A card shell — the design's white rounded-16 panel (padding 18px 20px). */
function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
      {children}
    </div>
  )
}

/** An inline, tokened error row with a retry affordance (§ four-branch). */
function InlineError({
  label,
  onRetry,
}: {
  label: string
  onRetry: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-sdn bg-sdn/40 px-3 py-2.5">
      <span className="text-[12px] font-semibold text-tdn">{label}</span>
      <button
        type="button"
        onClick={onRetry}
        className="text-[11.5px] font-bold text-tdn underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Retry
      </button>
    </div>
  )
}

/** Risk-rules card (design lines 5–8) — read-wired to `useAmlRules`. */
function RiskRulesCard({ onEdit }: { onEdit: (rule: AmlRule) => void }) {
  const query = useAmlRules()
  const rules = query.data?.rules ?? []

  return (
    <CardShell>
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Risk rules{" "}
        <span className="font-semibold text-ink3">
          · thresholds are maker-checker
        </span>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-[44px] rounded-[10px]" />
          <Skeleton className="h-[44px] rounded-[10px]" />
          <Skeleton className="h-[44px] rounded-[10px]" />
        </div>
      ) : query.isError ? (
        <InlineError
          label="Couldn't load risk rules."
          onRetry={() => query.refetch()}
        />
      ) : rules.length === 0 ? (
        <p className="py-2 text-[12px] text-ink3">No risk rules configured.</p>
      ) : (
        <div>
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 border-b border-line2 py-[11px] last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-bold text-ink">
                  {rule.name}
                </div>
                <div className="truncate text-[11px] text-ink3">
                  {rule.description}
                </div>
              </div>
              <span className="font-mono text-[12.5px] font-bold text-ink tabular-nums">
                {thresholdFromParameters(rule.parameters)}
              </span>
              <button
                type="button"
                onClick={() => onEdit(rule)}
                aria-label={`Edit rule ${rule.name}`}
                className="flex size-7 flex-none items-center justify-center rounded-lg border border-line text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <EditPencilIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

/** Open-cases card (design lines 10–13) — read-wired to `useComplianceEvents`. */
function OpenCasesCard({
  onDraftSar,
  onOpenCase,
}: {
  onDraftSar: () => void
  onOpenCase: (id: string) => void
}) {
  // The queue shows still-open cases; fetch unfiltered and narrow to open
  // statuses client-side (the API takes a single status filter — see shapeGaps).
  const query = useComplianceEvents({})
  const openCases = useMemo(
    () =>
      (query.data?.items ?? []).filter((e) => OPEN_STATUSES.includes(e.status)),
    [query.data]
  )

  return (
    <CardShell>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-extrabold text-ink">Open cases</div>
        <button
          type="button"
          onClick={onDraftSar}
          className="cursor-pointer text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Draft SAR/CTR
        </button>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-[40px] rounded-[10px]" />
          <Skeleton className="h-[40px] rounded-[10px]" />
        </div>
      ) : query.isError ? (
        <InlineError
          label="Couldn't load open cases."
          onRetry={() => query.refetch()}
        />
      ) : openCases.length === 0 ? (
        <p className="py-2 text-[12px] text-ink3">No open cases.</p>
      ) : (
        <div>
          {openCases.map((c) => {
            const meta = CASE_STATUS_META[c.status]
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenCase(c.id)}
                aria-label={`Open case ${caseTitle(c)}`}
                className="flex w-full items-center gap-[11px] border-b border-line2 py-2.5 text-left transition-colors last:border-b-0 hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span
                  aria-hidden="true"
                  className={cn("size-2 flex-none rounded-full", meta.dot)}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-ink">
                    {caseTitle(c)}
                  </div>
                  <div className="truncate text-[10.5px] text-ink3">
                    {caseMeta(c)}
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                    meta.pillBg,
                    meta.pillFg
                  )}
                >
                  {meta.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </CardShell>
  )
}

/** Travel-Rule records card (design lines 14–17) — read-wired to `useTravelRule`. */
function TravelRuleCard() {
  const query = useTravelRule()
  const count = query.data?.items.length ?? 0

  return (
    <CardShell>
      <div className="mb-2.5 text-[13px] font-extrabold text-ink">
        Travel Rule records
      </div>
      {query.isLoading ? (
        <Skeleton className="h-[36px] rounded-[10px]" />
      ) : query.isError ? (
        <InlineError
          label="Couldn't load Travel Rule records."
          onRetry={() => query.refetch()}
        />
      ) : count === 0 ? (
        <p className="text-[12px] leading-normal text-ink2">
          No qualifying transfers captured.
        </p>
      ) : (
        <p className="text-[12px] leading-normal text-ink2">
          Originator/beneficiary records attached for{" "}
          <b className="font-bold">{count}</b> qualifying{" "}
          {count === 1 ? "transfer" : "transfers"} over the reporting threshold.
        </p>
      )}
    </CardShell>
  )
}

// ── Compliance reports (RIGHT bottom) — SAR/STR filings ──────────────────────────

// Report status → { pill label, pill surface + text } (§5 status→token map). Draft
// reads warning, submitted reads info, closed reads success, rejected reads danger.
const REPORT_STATUS_META: Record<
  ComplianceReport["status"],
  { label: string; pillBg: string; pillFg: string }
> = {
  draft: { label: "Draft", pillBg: "bg-swn", pillFg: "text-twn" },
  submitted: { label: "Submitted", pillBg: "bg-sif", pillFg: "text-tif" },
  rejected: { label: "Rejected", pillBg: "bg-sdn", pillFg: "text-tdn" },
  closed: { label: "Closed", pillBg: "bg-sok", pillFg: "text-tok" },
}

/**
 * Compliance-reports card — read-only SAR/STR filing list (Phase 6b, wired to
 * `useComplianceReports`). Each row shows the report type (SAR/STR), a status
 * pill, its linked-event count, and the created/submitted timestamp.
 */
function ReportsCard() {
  const query = useComplianceReports()
  const reports = query.data?.items ?? []

  return (
    <CardShell>
      <div className="mb-2.5 text-[13px] font-extrabold text-ink">
        Compliance reports{" "}
        <span className="font-semibold text-ink3">· SAR / STR filings</span>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-[36px] rounded-[10px]" />
          <Skeleton className="h-[36px] rounded-[10px]" />
        </div>
      ) : query.isError ? (
        <InlineError
          label="Couldn't load compliance reports."
          onRetry={() => query.refetch()}
        />
      ) : reports.length === 0 ? (
        <p className="py-1 text-[12px] text-ink3">No reports filed yet.</p>
      ) : (
        <div>
          {reports.map((report) => {
            const meta = REPORT_STATUS_META[report.status]
            const when = new Date(
              report.submittedAt ?? report.createdAt
            ).toLocaleDateString()
            return (
              <div
                key={report.id}
                className="flex items-center gap-[11px] border-b border-line2 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-bold text-ink uppercase">
                    {report.reportType}
                  </div>
                  <div className="truncate text-[10.5px] text-ink3">
                    {report.relatedEvents.length}{" "}
                    {report.relatedEvents.length === 1 ? "case" : "cases"} · {when}
                    {report.submissionRef ? ` · ${report.submissionRef}` : ""}
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                    meta.pillBg,
                    meta.pillFg
                  )}
                >
                  {meta.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </CardShell>
  )
}

// ── Compliance-event detail drill-in (Phase 6b) ──────────────────────────────────

/** Format a nullable ISO timestamp for the disposition note, else em dash. */
function formatDisposedAt(iso: string | null): string {
  if (iso === null) return "—"
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/**
 * Case-detail dialog — a read-only drill-in on one flagged compliance event
 * (`useComplianceEvent`). Surfaces the event's classification, the raw screening
 * `details` payload (pretty-printed JSON), and the disposition note
 * (`dispositionComment` + `dispositionAt`). Read-only — dispositioning is Phase 7.
 */
function CaseDetailDialog({
  eventId,
  onOpenChange,
}: {
  eventId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const query = useComplianceEvent(eventId)
  const event = query.data ?? null

  return (
    <Dialog open={eventId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="w-[520px] max-w-[94vw] gap-0 p-6">
        <DialogTitle>Compliance case</DialogTitle>
        <DialogDescription className="mt-1 mb-4 text-[12.5px] leading-normal text-ink2">
          Raw screening payload and disposition note. Read-only — dispositioning
          is a step-up action (Phase 7).
        </DialogDescription>

        {query.isLoading ? (
          <div className="flex flex-col gap-2.5" aria-busy="true">
            <Skeleton className="h-[20px] w-1/2 rounded-[8px]" />
            <Skeleton className="h-[120px] rounded-[10px]" />
          </div>
        ) : query.isError ? (
          <InlineError
            label="Couldn't load the case."
            onRetry={() => query.refetch()}
          />
        ) : event === null ? (
          <p className="py-2 text-[12px] text-ink3">Case not found.</p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {/* Classification */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
              <div>
                <dt className="text-ink3">Type</dt>
                <dd className="font-semibold text-ink">{event.eventType}</dd>
              </div>
              <div>
                <dt className="text-ink3">Severity</dt>
                <dd className="font-semibold text-ink capitalize">
                  {event.severity}
                </dd>
              </div>
              <div>
                <dt className="text-ink3">Status</dt>
                <dd className="font-semibold text-ink">{event.status}</dd>
              </div>
              <div>
                <dt className="text-ink3">Provider</dt>
                <dd className="font-semibold text-ink">
                  {event.screeningProvider}
                </dd>
              </div>
            </dl>

            {/* Raw screening payload */}
            <div>
              <div className="mb-1.5 text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase">
                Screening payload
              </div>
              <pre className="max-h-[220px] overflow-auto rounded-[10px] border border-line bg-card2 p-3 font-mono text-[11px] leading-relaxed text-ink2">
                {JSON.stringify(event.details, null, 2)}
              </pre>
            </div>

            {/* Disposition note */}
            <div>
              <div className="mb-1.5 text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase">
                Disposition note
              </div>
              <p className="text-[12.5px] text-ink2">
                {event.dispositionComment ?? "Not yet dispositioned."}
              </p>
              <p className="mt-1 text-[11px] text-ink3">
                {formatDisposedAt(event.dispositionAt)}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────────

// The active flow: editing a risk-rule threshold (maker-checker) or drafting a SAR/CTR
// (reason). Mirrors how the design's `runFlow` chains each affordance to a flow modal.
// These are WRITE paths — left as design no-op flows for Phase 7.
type ActiveFlow =
  | { kind: "editRule"; rule: AmlRule }
  | { kind: "draftSar" }
  | null

export function AmlPage() {
  const [flow, setFlow] = useState<ActiveFlow>(null)
  // The open case's id whose read-only detail drill-in is showing (Phase 6b).
  const [caseId, setCaseId] = useState<string | null>(null)

  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header (design line 3) ─────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          AML / risk
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Rules, case management, SAR/CTR drafting and Travel Rule records.
        </p>
      </div>

      {/* ── 1.2fr / 1fr grid (design line 4) ───────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[1.2fr_1fr]">
        <RiskRulesCard onEdit={(rule) => setFlow({ kind: "editRule", rule })} />
        <div className="flex flex-col gap-[14px]">
          <OpenCasesCard
            onDraftSar={() => setFlow({ kind: "draftSar" })}
            onOpenCase={setCaseId}
          />
          <TravelRuleCard />
          <ReportsCard />
        </div>
      </div>

      {/* ── Case-detail drill-in (Phase 6b read) ───────────────────────────── */}
      <CaseDetailDialog
        eventId={caseId}
        onOpenChange={(next) => !next && setCaseId(null)}
      />

      {/* ── Flow modals (shared funds-safety flows, SPEC §5) — Phase 7 writes ── */}

      {/* Edit threshold → MakerCheckerModal (dual-control; enters Pending approval). */}
      <MakerCheckerModal
        open={flow?.kind === "editRule"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow?.kind === "editRule"
            ? `Edit threshold — ${flow.rule.name}`
            : "Edit risk-rule threshold"
        }
        diff={
          flow?.kind === "editRule"
            ? [
                {
                  field: flow.rule.name,
                  from: thresholdFromParameters(flow.rule.parameters),
                  to: thresholdFromParameters(flow.rule.parameters),
                },
              ]
            : []
        }
        onSubmit={() => setFlow(null)}
      />

      {/* Draft SAR/CTR → ReasonModal (recorded in the immutable audit log). */}
      <ReasonModal
        open={flow?.kind === "draftSar"}
        onOpenChange={(next) => !next && setFlow(null)}
        title="Draft SAR/CTR"
        onContinue={() => setFlow(null)}
      />
    </div>
  )
}
