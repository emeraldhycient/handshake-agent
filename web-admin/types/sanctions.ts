/** Sanctions & screening page (§6.5). */

// ─── Sanctions & screening page (§6.5) ───────────────────────────────────────────────

/** A dispositioned match's terminal state (the contract disposition union verbatim). */
export type SanctionsMatchDone =
  import("@handshake-agent/contracts").SanctionsDisposition

/** One ongoing-monitoring status row (read-only), seeded from the config view. */
export interface SanctionsMonitorRow {
  key: keyof import("@handshake-agent/contracts").SanctionsMonitoringView
  label: string
  on: boolean
}

/** The active disposition flow. Every kind captures its input then fires the POST. */
export type SanctionsActiveFlow =
  | { kind: "clear"; matchId: string }
  | { kind: "escalate"; matchId: string }
  | { kind: "block"; matchId: string }
  | null

/** One screening-match card — open matches offer Clear / Escalate / Block. */
export interface SanctionsMatchCardProps {
  record: import("@handshake-agent/contracts").SanctionsRecordItem
  done: SanctionsMatchDone | null
  onClear: () => void
  onEscalate: () => void
  onBlock: () => void
}

/** The screening-match list — loading / error / empty / data over the cards. */
export interface SanctionsMatchListProps {
  records: import("@handshake-agent/contracts").SanctionsRecordItem[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  onRetry: () => void
  doneOf: (
    record: import("@handshake-agent/contracts").SanctionsRecordItem
  ) => SanctionsMatchDone | null
  onClear: (id: string) => void
  onEscalate: (id: string) => void
  onBlock: (id: string) => void
}

/** The shared disposition flow modals (Clear / Escalate / Block). */
export interface SanctionsFlowModalsProps {
  flow: SanctionsActiveFlow
  labelOf: (matchId: string) => string
  onClose: () => void
  /**
   * Fire the disposition mutation (server-step-up-gated). `comment` carries the
   * operator's typed reason so it lands on the audited annotation.
   */
  onDisposition: (
    matchId: string,
    done: SanctionsMatchDone,
    comment?: string
  ) => void
  mfaEnabled: boolean
  stepUpOpen: boolean
  onStepUpOpenChange: (open: boolean) => void
  onStepUpSuccess: () => void
}
