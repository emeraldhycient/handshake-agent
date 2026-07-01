"use client"

/**
 * SanctionsPage — the sanctions & screening surface, reproduced pixel-for-pixel from
 * `docs/design-ref/screens/Sanctions.html` (SPEC §6.5). Two sections:
 *
 *   1. Screening match cards — a red-triangle danger mark, the matched name, the
 *      matched list/type, a Score, and per-match disposition (Clear / Escalate /
 *      Block) or a done-label once dispositioned.
 *   2. Ongoing monitoring — a card of soft-toggle rows.
 *
 * DESIGN REPRODUCTION (not data-wired): the content is the design's own representative
 * sample, embedded as module-level constants below (the `logic.js` `vSanctions()` view
 * method is truncated in the design source, so the rows mirror the markup + SPEC §6.5 +
 * the `seed()` dataset shapes — customer names like "Musa Sani", sanctions lists like
 * OFAC SDN). No fetching; real-data reintegration is a separate later step.
 *
 * Disposition actions open the shared funds-safety flow modals exactly as the design's
 * `runFlow` chains them (SPEC §5 "Flow modals"): Clear → ReasonModal (recorded in the
 * immutable audit log); Escalate → MakerCheckerModal (enters Pending approval, a second
 * admin decides); Block → ReasonModal → StepUpModal (a sensitive, step-up-gated action).
 * On completion the card flips to its done-label, matching the design's per-row state.
 */
import { useState } from "react"

import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import {
  ReasonModal,
  StepUpModal,
  MakerCheckerModal,
} from "@/components/admin/flows"

// ── The design's screening matches (representative sample; SPEC §6.5 + seed() shapes) ──

type MatchDone = "cleared" | "escalated" | "blocked"

interface ScreeningMatch {
  id: string
  /** Matched customer / counterparty name (seed() `F[i]+' '+L[i]` shape). */
  name: string
  /** The screening list the name matched (design "Matched <b>{list}</b>"). */
  list: string
  /** The match type — name vs address (design "· {type}"). */
  type: string
  /** Match-confidence score (0–100). Colour follows severity, never the sole signal. */
  score: number
  /** Score text token — red for strong, amber for partial, muted for weak. */
  scoreFg: string
}

const SCREENING_MATCHES: readonly ScreeningMatch[] = [
  {
    id: "scr_9012",
    name: "Musa Sani",
    list: "OFAC SDN",
    type: "Name match",
    score: 96,
    scoreFg: "text-tdn",
  },
  {
    id: "scr_9013",
    name: "Ibrahim Danjuma",
    list: "EU Consolidated",
    type: "Name + DOB",
    score: 88,
    scoreFg: "text-tdn",
  },
  {
    id: "scr_9014",
    name: "Blessing Okafor",
    list: "UN Security Council",
    type: "Address match",
    score: 71,
    scoreFg: "text-twn",
  },
]

// The design's monitoring toggles (representative content; SPEC §6.5 "toggle rows").
const MONITOR_ROWS: readonly { label: string; defaultOn: boolean }[] = [
  {
    label: "Re-screen all customers daily against updated lists",
    defaultOn: true,
  },
  { label: "Screen every counterparty on outbound transfer", defaultOn: true },
  {
    label: "Alert on new PEP (politically exposed person) matches",
    defaultOn: true,
  },
  { label: "Auto-block confirmed OFAC SDN-list hits", defaultOn: false },
]

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
 * One screening match rendered as the design's card (design lines 6–14). Open matches
 * offer Clear / Escalate / Block; dispositioned matches show a done-label.
 */
function SanctionsMatchCard({
  match,
  done,
  onClear,
  onEscalate,
  onBlock,
}: {
  match: ScreeningMatch
  done: MatchDone | null
  onClear: () => void
  onEscalate: () => void
  onBlock: () => void
}) {
  const open = done === null

  return (
    <div
      className={cn(
        "rounded-[16px] border bg-card px-5 py-4",
        open ? "border-sdn" : "border-line"
      )}
    >
      <div className="flex items-center gap-[13px]">
        <TriangleMark open={open} />

        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-ink">{match.name}</div>
          <div className="text-[11.5px] text-ink2">
            Matched <b className="font-bold">{match.list}</b> · {match.type}
          </div>
        </div>

        <div className="mr-1.5 flex-none text-center">
          <div className="text-[10px] font-bold tracking-[0.04em] text-ink3 uppercase">
            Score
          </div>
          <div
            className={cn(
              "font-mono text-base font-extrabold tabular-nums",
              open ? match.scoreFg : "text-ink3"
            )}
          >
            {match.score}
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

/** The ongoing-monitoring card (design lines 17–20). */
function OngoingMonitoring() {
  return (
    <div className="mt-3.5 rounded-[16px] border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Ongoing monitoring
      </div>
      <ul>
        {MONITOR_ROWS.map((row) => (
          <li
            key={row.label}
            className="flex items-center justify-between gap-4 border-b border-line2 py-2.5 last:border-b-0"
          >
            <span className="text-[12.5px] text-ink2">{row.label}</span>
            <Switch defaultChecked={row.defaultOn} aria-label={row.label} />
          </li>
        ))}
      </ul>
    </div>
  )
}

// The active disposition flow (mirrors the design's `runFlow` step chain).
type ActiveFlow =
  | { kind: "clear"; matchId: string }
  | { kind: "escalate"; matchId: string }
  | { kind: "block"; matchId: string; step: "reason" | "stepup" }
  | null

export function SanctionsPage() {
  // Per-match disposition outcome (null = still open). Drives each card's state.
  const [outcomes, setOutcomes] = useState<Record<string, MatchDone>>({})
  const [flow, setFlow] = useState<ActiveFlow>(null)

  function nameOf(matchId: string): string {
    return SCREENING_MATCHES.find((m) => m.id === matchId)?.name ?? "match"
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
      <div className="flex flex-col gap-3">
        {SCREENING_MATCHES.map((match) => (
          <SanctionsMatchCard
            key={match.id}
            match={match}
            done={outcomes[match.id] ?? null}
            onClear={() => setFlow({ kind: "clear", matchId: match.id })}
            onEscalate={() => setFlow({ kind: "escalate", matchId: match.id })}
            onBlock={() =>
              setFlow({ kind: "block", matchId: match.id, step: "reason" })
            }
          />
        ))}
      </div>

      {/* ── Ongoing monitoring (design lines 17–20) ────────────────────────── */}
      <OngoingMonitoring />

      {/* ── Disposition flow modals (shared funds-safety flows, SPEC §5) ────── */}

      {/* Clear → ReasonModal (recorded in the immutable audit log). */}
      <ReasonModal
        open={flow?.kind === "clear"}
        onOpenChange={(next) => !next && setFlow(null)}
        title={
          flow?.kind === "clear"
            ? `Clear screening match — ${nameOf(flow.matchId)}`
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
            ? `Escalate screening match — ${nameOf(flow.matchId)}`
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
            ? `Block — ${nameOf(flow.matchId)}`
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
            ? `Block — ${nameOf(flow.matchId)}`
            : "Block match"
        }
        onComplete={() =>
          flow?.kind === "block" && disposition(flow.matchId, "blocked")
        }
      />
    </div>
  )
}
