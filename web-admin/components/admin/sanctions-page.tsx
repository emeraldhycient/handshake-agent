"use client"

/**
 * SanctionsPage — the sanctions & screening surface, reproduced pixel-for-pixel from
 * `docs/design-ref/screens/Sanctions.html` (SPEC §6.5). Two sections:
 *
 *   1. Screening match cards — a red-triangle danger mark, the matched counterparty,
 *      the screening provider/type, a verdict chip, and per-match disposition
 *      (Clear / Escalate / Block) or a done-label once dispositioned.
 *   2. Ongoing monitoring — a card of soft-toggle rows.
 *
 * DATA WIRING (Phase 6b — reads only): the screening match cards are driven by the
 * real `useSanctions()` hook (`SanctionsRecordItem`). The backend now DERIVES the
 * design's rich fields from the immutable screening columns: `matchedList` (human
 * list name ⇐ provider), `matchType` (⇐ screeningType), and a numeric 0–100
 * `matchScore` (verdict-banded) fill the design's matched-list subtitle and Score
 * slot. The four async branches (loading / error / empty / data) each render.
 *
 * The Ongoing-monitoring toggles are seeded from the real `useSanctionsMonitoring()`
 * hook (the four policy flags resolved from layered AppSetting config). The Switch
 * stays CONTROLLED off local `useState` seeded from those values — a lightweight
 * soft-toggle exactly as the design chains it; persisting a toggle is a Phase-7 write.
 *
 * Disposition actions (Clear / Escalate / Block) are Phase-7 writes and are left
 * exactly as the design's `runFlow` chains them (SPEC §5 "Flow modals"): Clear →
 * ReasonModal (recorded in the immutable audit log); Escalate → MakerCheckerModal
 * (enters Pending approval, a second admin decides); Block → ReasonModal → StepUpModal
 * (a sensitive, step-up-gated action). On completion the card flips to its done-label.
 */
import { useMemo, useState } from "react"

import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ReasonModal,
  StepUpModal,
  MakerCheckerModal,
} from "@/components/admin/flows"
import { useSanctions, useSanctionsMonitoring } from "@/lib/query/hooks"
import type {
  SanctionsMonitoringView,
  SanctionsRecordItem,
} from "@handshake-agent/contracts"

// ── Presentation types ────────────────────────────────────────────────────────────

type MatchDone = "cleared" | "escalated" | "blocked"

/** The verdict token + label shown in the design's Score slot (the DTO carries no
 *  numeric confidence score — see shapeGaps). Colour follows severity, never the sole
 *  signal (an explicit label sits alongside it). */
const VERDICT_META: Record<
  SanctionsRecordItem["verdict"],
  { label: string; fg: string; danger: boolean }
> = {
  hit: { label: "Hit", fg: "text-tdn", danger: true },
  inconclusive: { label: "Review", fg: "text-twn", danger: true },
  clear: { label: "Clear", fg: "text-tok", danger: false },
}

// The monitoring toggles. Each row's ON/OFF is seeded from the real config view
// (`SanctionsMonitoringView`); the Switch then stays controlled off local state
// (persisting a toggle is a Phase-7 write).
interface MonitorRow {
  key: keyof SanctionsMonitoringView
  label: string
  on: boolean
}

/** Ordered row labels keyed by the monitoring-view flag they surface. */
const MONITOR_LABELS: readonly {
  key: keyof SanctionsMonitoringView
  label: string
}[] = [
  {
    key: "reScreenDaily",
    label: "Re-screen all customers daily against updated lists",
  },
  {
    key: "screenOnOutbound",
    label: "Screen every counterparty on outbound transfer",
  },
  {
    key: "pepAlert",
    label: "Alert on new PEP (politically exposed person) matches",
  },
  { key: "autoBlockOfac", label: "Auto-block confirmed OFAC SDN-list hits" },
]

/** Projects the fetched monitoring view onto the ordered display rows. */
function toMonitorRows(view: SanctionsMonitoringView): MonitorRow[] {
  return MONITOR_LABELS.map(({ key, label }) => ({
    key,
    label,
    on: view[key],
  }))
}

// The done-label + token shown once a match has been dispositioned.
const DONE_META: Record<MatchDone, { label: string; className: string }> = {
  cleared: { label: "Cleared", className: "text-tok" },
  escalated: { label: "Escalated", className: "text-twn" },
  blocked: { label: "Blocked", className: "text-tdn" },
}

/** The red-triangle danger mark (design line 8 icon tile). */
function TriangleMark({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 flex-none items-center justify-center rounded-[11px]",
        open ? "bg-sdn text-tdn" : "bg-card2 text-ink3"
      )}
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
  )
}

/** A ghost disposition button (Clear / Escalate) — design line 11. */
function GhostAction({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-[9px] border border-line px-[14px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {label}
    </button>
  )
}

/**
 * One screening record rendered as the design's match card (design lines 6–14). Open
 * matches offer Clear / Escalate / Block; dispositioned matches show a done-label.
 * The `counterpartyId` fills the design's name slot; `provider` · `screeningType`
 * fill the matched-list/match-type subtitle; `verdict` fills the Score slot (the DTO
 * has no confidence score — see shapeGaps).
 */
function SanctionsMatchCard({
  record,
  done,
  onClear,
  onEscalate,
  onBlock,
}: {
  record: SanctionsRecordItem
  done: MatchDone | null
  onClear: () => void
  onEscalate: () => void
  onBlock: () => void
}) {
  const open = done === null
  const verdict = VERDICT_META[record.verdict]
  const flagged = open && verdict.danger

  return (
    <div
      className={cn(
        "rounded-[16px] border bg-card px-5 py-4",
        flagged ? "border-sdn" : "border-line"
      )}
    >
      <div className="flex items-center gap-[13px]">
        <TriangleMark open={flagged} />

        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-bold text-ink">
            {record.counterpartyId}
          </div>
          <div className="text-[11.5px] text-ink2">
            <b className="font-bold">{record.matchedList}</b> ·{" "}
            {record.matchType}
          </div>
        </div>

        {/* Score slot (design line 10): the numeric 0–100 confidence with the
            verdict label beneath it (colour follows severity, never the sole
            signal — the verdict word sits alongside). */}
        <div className="mr-1.5 flex-none text-center">
          <div className="text-[10px] font-bold tracking-[0.04em] text-ink3 uppercase">
            Score
          </div>
          <div
            className={cn(
              "text-sm font-extrabold",
              open ? verdict.fg : "text-ink3"
            )}
          >
            {record.matchScore}
          </div>
          <div className="text-[10px] font-bold text-ink3">
            {verdict.label}
          </div>
        </div>

        {open ? (
          <div className="flex gap-2">
            <GhostAction label="Clear" onClick={onClear} />
            <GhostAction label="Escalate" onClick={onEscalate} />
            <button
              type="button"
              onClick={onBlock}
              className="cursor-pointer rounded-[9px] bg-tdn px-[15px] py-2 text-xs font-extrabold text-white transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Block
            </button>
          </div>
        ) : (
          <span
            className={cn("text-[11.5px] font-bold", DONE_META[done].className)}
          >
            {DONE_META[done].label}
          </span>
        )}
      </div>
    </div>
  )
}

/** Loading placeholder for the match-card list (matches the card silhouette). */
function LoadingMatches() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-[74px] w-full rounded-[16px]" />
      <Skeleton className="h-[74px] w-full rounded-[16px]" />
      <Skeleton className="h-[74px] w-full rounded-[16px]" />
    </div>
  )
}

/** Tokened inline error with a retry affordance. */
function ErrorMatches({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
      <p className="text-sm font-bold text-tdn">
        Failed to load screening matches
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 cursor-pointer rounded-[9px] border border-line bg-card px-[14px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Retry
      </button>
    </div>
  )
}

/** Design-consistent empty state for the match-card list. */
function EmptyMatches() {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-8 text-center">
      <p className="text-sm font-bold text-ink">No screening matches</p>
      <p className="mt-1 text-[12.5px] text-ink2">
        Screening runs with no flagged counterparties will appear here.
      </p>
    </div>
  )
}

/** Card chrome shared by every branch of the ongoing-monitoring section. */
function MonitoringCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3.5 rounded-[16px] border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Ongoing monitoring
      </div>
      {children}
    </div>
  )
}

/**
 * The ongoing-monitoring card (design lines 17–20). Rows are seeded from the real
 * `useSanctionsMonitoring()` view (four policy flags from layered config), then each
 * Switch is CONTROLLED off local `useState` so it genuinely flips + holds when
 * clicked (persisting a toggle is a Phase-7 write). Four async branches render.
 */
function OngoingMonitoring() {
  const monitoring = useSanctionsMonitoring()
  // Local optimistic soft-toggle overrides (persisting a toggle is a Phase-7 write);
  // the base value comes straight from the fetched config view — derived, not an effect.
  const [overrides, setOverrides] = useState<
    Partial<Record<keyof SanctionsMonitoringView, boolean>>
  >({})
  const rows = useMemo<MonitorRow[]>(
    () =>
      monitoring.data
        ? toMonitorRows(monitoring.data).map((r) => ({
            ...r,
            on: overrides[r.key] ?? r.on,
          }))
        : [],
    [monitoring.data, overrides]
  )

  if (monitoring.isLoading) {
    return (
      <MonitoringCard>
        <div className="flex flex-col gap-2.5" aria-busy="true">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </MonitoringCard>
    )
  }

  if (monitoring.isError) {
    return (
      <MonitoringCard>
        <p className="text-[12.5px] font-bold text-tdn">
          Failed to load monitoring policy
        </p>
        <button
          type="button"
          onClick={() => void monitoring.refetch()}
          className="mt-2 cursor-pointer rounded-[9px] border border-line bg-card px-[14px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </MonitoringCard>
    )
  }

  if (rows.length === 0) {
    return (
      <MonitoringCard>
        <p className="text-[12.5px] text-ink2">No monitoring policy configured.</p>
      </MonitoringCard>
    )
  }

  return (
    <MonitoringCard>
      <ul>
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-center justify-between gap-4 border-b border-line2 py-2.5 last:border-b-0"
          >
            <span className="text-[12.5px] text-ink2">{row.label}</span>
            <Switch
              checked={row.on}
              onCheckedChange={(next) =>
                setOverrides((prev) => ({ ...prev, [row.key]: next }))
              }
              aria-label={row.label}
            />
          </li>
        ))}
      </ul>
    </MonitoringCard>
  )
}

// The active disposition flow (mirrors the design's `runFlow` step chain).
type ActiveFlow =
  | { kind: "clear"; matchId: string }
  | { kind: "escalate"; matchId: string }
  | { kind: "block"; matchId: string; step: "reason" | "stepup" }
  | null

export function SanctionsPage() {
  const sanctions = useSanctions()
  const records = sanctions.data?.items ?? []

  // Per-match disposition outcome (null = still open). Drives each card's state.
  const [outcomes, setOutcomes] = useState<Record<string, MatchDone>>({})
  const [flow, setFlow] = useState<ActiveFlow>(null)

  function labelOf(matchId: string): string {
    return records.find((r) => r.id === matchId)?.counterpartyId ?? "match"
  }

  function disposition(matchId: string, done: MatchDone) {
    setOutcomes((prev) => ({ ...prev, [matchId]: done }))
    setFlow(null)
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header (design line 3) ─────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Sanctions &amp; screening
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Name and address matches from ongoing screening. Clear, escalate, or
          block.
        </p>
      </div>

      {/* ── Screening match cards (design lines 4–16) ──────────────────────── */}
      {sanctions.isLoading && <LoadingMatches />}
      {sanctions.isError && (
        <ErrorMatches onRetry={() => void sanctions.refetch()} />
      )}
      {sanctions.isSuccess && records.length === 0 && <EmptyMatches />}
      {sanctions.isSuccess && records.length > 0 && (
        <div className="flex flex-col gap-3">
          {records.map((record) => (
            <SanctionsMatchCard
              key={record.id}
              record={record}
              done={outcomes[record.id] ?? null}
              onClear={() => setFlow({ kind: "clear", matchId: record.id })}
              onEscalate={() =>
                setFlow({ kind: "escalate", matchId: record.id })
              }
              onBlock={() =>
                setFlow({ kind: "block", matchId: record.id, step: "reason" })
              }
            />
          ))}
        </div>
      )}

      {/* ── Ongoing monitoring (design lines 17–20) ────────────────────────── */}
      <OngoingMonitoring />

      {/* ── Disposition flow modals (shared funds-safety flows, SPEC §5) ────── */}

      {/* Clear → ReasonModal (recorded in the immutable audit log). */}
      <ReasonModal
        open={flow?.kind === "clear"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow?.kind === "clear"
            ? `Clear screening match — ${labelOf(flow.matchId)}`
            : "Clear screening match"
        }
        onContinue={() =>
          flow?.kind === "clear" && disposition(flow.matchId, "cleared")
        }
      />

      {/* Escalate → MakerCheckerModal (enters Pending approval). */}
      <MakerCheckerModal
        open={flow?.kind === "escalate"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow?.kind === "escalate"
            ? `Escalate screening match — ${labelOf(flow.matchId)}`
            : "Escalate screening match"
        }
        diff={[
          {
            field: "Screening disposition",
            from: "Open match",
            to: "Escalated for review",
          },
        ]}
        onSubmit={() =>
          flow?.kind === "escalate" && disposition(flow.matchId, "escalated")
        }
      />

      {/* Block → ReasonModal → StepUpModal (sensitive, step-up-gated). */}
      <ReasonModal
        open={flow?.kind === "block" && flow.step === "reason"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow?.kind === "block"
            ? `Block — ${labelOf(flow.matchId)}`
            : "Block match"
        }
        onContinue={() =>
          flow?.kind === "block" &&
          setFlow({ kind: "block", matchId: flow.matchId, step: "stepup" })
        }
      />
      <StepUpModal
        open={flow?.kind === "block" && flow.step === "stepup"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow?.kind === "block"
            ? `Block — ${labelOf(flow.matchId)}`
            : "Block match"
        }
        onComplete={() =>
          flow?.kind === "block" && disposition(flow.matchId, "blocked")
        }
      />
    </div>
  )
}
