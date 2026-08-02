/** Reconciliation page + its run-history panel. */

// ─── Reconciliation page (design §6.12) ────────────────────────────────────────────
// No reconciliation endpoint exists yet, so the Recon screen is design-faithful:
// these shapes describe the component's local sample content, not a contracts DTO.

/** Break severity → the canonical status pill (high=danger, medium=warn, low=info). */
export type ReconBreakSeverity = "high" | "medium" | "low"

/** What the operator did to close a break (drives the confirmed-outcome footer). */
export type ReconBreakResolution = "resolved" | "accepted" | "escalated"

/** A live `ReconBreak` (contract) with a locally-applied disposition overlaid. */
export type ReconBreakView = import("@handshake-agent/contracts").ReconBreak & {
  localResolution?: ReconBreakResolution
}

/** The three action flows a break card can open (each with its stage). */
export type ReconFlowStep =
  | { kind: "resolve"; stage: "reason" | "engine" }
  | { kind: "accept"; stage: "reason" | "confirm" }
  | { kind: "escalate" }

/** The cron status bar over the break board — last/next run + open-breaks + Run now. */
export interface ReconStatusBarProps {
  status: import("@handshake-agent/contracts").ReconStatus | undefined
  isLoading: boolean
  isError: boolean
  openCount: number
  onRunNow: () => void
}

/** One reconciliation break card — open shows the action row, closed the outcome footer. */
export interface ReconBreakCardProps {
  item: ReconBreakView
  onOpenTx: (transactionId: string) => void
  onEscalate: (id: string) => void
  onAccept: (id: string) => void
  onResolve: (id: string) => void
}

/** The break board — loading / error / empty / data over `ReconBreakCard`. */
export interface ReconBreakListProps {
  breaks: ReconBreakView[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  onOpenTx: (transactionId: string) => void
  onEscalate: (id: string) => void
  onAccept: (id: string) => void
  onResolve: (id: string) => void
}

/** The shared step-up-gated flow modals for the currently-active break. */
export interface ReconBreakFlowsProps {
  activeBreak: ReconBreakView
  flow: ReconFlowStep
  reason: string
  onClose: () => void
  /** Advance to the next stage (accept→confirm, resolve→engine). */
  onAdvance: (flow: ReconFlowStep) => void
  /** Capture the audited reason before the confirm/engine leg. */
  onCaptureReason: (reason: string) => void
  /** Fire the real disposition mutation (step-up-gated). */
  onDisposition: (
    id: string,
    resolution: ReconBreakResolution,
    reason: string
  ) => void
}

// ─── Reconciliation run-history panel (Go-readiness #3) ──────────────────────────────

/** A durable-run break disposition — triage (acknowledge) or close (resolve). */
export type ReconActionKind = "acknowledge" | "resolve"

/** The break awaiting an audited reason before its step-up-gated disposition. */
export interface ReconPendingAction {
  breakId: string
  kind: ReconActionKind
}

/** The detected breaks for one expanded run (lazily fetched on expand). */
export interface RunBreaksProps {
  runId: string
  onAct: (breakId: string, kind: ReconActionKind) => void
}

/** One expandable run row — status/type/counts header + the lazily-loaded breaks. */
export interface ReconRunRowProps {
  run: import("@handshake-agent/contracts").ReconRun
  expanded: boolean
  onToggle: () => void
  onAct: (breakId: string, kind: ReconActionKind) => void
}

/** The run-history list — the four async branches over the durable runs read. */
export interface ReconRunListProps {
  isPending: boolean
  isError: boolean
  isSuccess: boolean
  runs: readonly import("@handshake-agent/contracts").ReconRun[]
  expandedId: string | null
  onToggle: (runId: string) => void
  onAct: (breakId: string, kind: ReconActionKind) => void
}
