/** AML / risk page (§6.6). */

import type { ReactNode } from "react"
import type { AmlRule, ComplianceReport } from "@handshake-agent/contracts"

// ─── AML / risk page (§6.6) ─────────────────────────────────────────────────────────

/** The design's white rounded-16 card shell. */
export interface CardShellProps {
  children: ReactNode
}

/** An inline, tokened error row with a retry affordance (the § four-branch error). */
export interface InlineErrorProps {
  label: string
  onRetry: () => void
}

/** Risk-rules card — read-wired; the pencil opens the maker-checker edit dialog. */
export interface RiskRulesCardProps {
  onEdit: (rule: AmlRule) => void
}

/** Open-cases card — the flagged/under-review queue; rows open the case drawer. */
export interface OpenCasesCardProps {
  onDraftSar: () => void
  onOpenCase: (id: string) => void
}

/** Compliance-reports card — a draft row exposes a step-up-gated Submit. */
export interface ReportsCardProps {
  onSubmit: (report: ComplianceReport) => void
}
