/** Compliance page + console tabs and the compliance report dialogs. */

import type { AmlRule, ComplianceReport } from "@handshake-agent/contracts"

// ─── Compliance page ─────────────────────────────────────────────────────────────

export interface ComplianceEventDetailProps {
  /** The selected event's id, or null when the drawer is closed. */
  eventId: string | null
  onOpenChange: (open: boolean) => void
}

/** The event metadata section — severity/status/user/tx/provider/rule + any disposition. */
export interface ComplianceEventSummaryProps {
  event: import("@handshake-agent/contracts").ComplianceEventDetail
}

/** The disposition form — status select + audited comment + the step-up-gated apply. */
export interface ComplianceDispositionFormProps {
  status: import("@handshake-agent/contracts").ComplianceDispositionRequest["status"]
  onStatusChange: (
    status: import("@handshake-agent/contracts").ComplianceDispositionRequest["status"]
  ) => void
  comment: string
  onCommentChange: (comment: string) => void
  busy: boolean
  onApply: () => void
  localError: string | null
}

export interface AmlRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing rule, or null to create a new one. */
  rule: AmlRule | null
}

/** The AML rule create/edit form body — mounted only while the dialog is open. */
export interface AmlRuleFormProps {
  rule: AmlRule | null
  onClose: () => void
}

/** The five compliance-console tabs. */
export type ComplianceTab =
  | "Events"
  | "AML Rules"
  | "Travel Rule"
  | "Reports"
  | "Sanctions"

/** Inline tokened error panel (a data-tab's error branch). */
export interface ErrorPanelProps {
  what: string
}

/** Events tab — the flagged-event queue; a row opens the disposition drawer. */
export interface EventsTabProps {
  onOpen: (id: string) => void
}

/** AML Rules tab — the engine rules list; the pencil opens the edit dialog. */
export interface AmlRulesTabProps {
  onEdit: (rule: AmlRule) => void
}

/** Reports tab — SAR/STR filings; a draft row exposes a Submit. */
export interface ReportsTabProps {
  onSubmit: (report: ComplianceReport) => void
}

/** One screening-run match card (red danger mark on a hit). */
export interface SanctionsCardProps {
  record: import("@handshake-agent/contracts").SanctionsRecordItem
}

export interface ComplianceReportDraftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The report types a SAR/STR draft can carry — sourced from the contract enum. */
export type ComplianceReportType =
  import("@handshake-agent/contracts").ComplianceReportDraftRequest["reportType"]

/** Inputs of the "Draft compliance report" dialog (report type, event ids, JSON content). */
export interface DraftFormFieldsProps {
  reportType: ComplianceReportType
  onReportTypeChange: (value: ComplianceReportType) => void
  eventsText: string
  onEventsTextChange: (value: string) => void
  content: string
  onContentChange: (value: string) => void
  busy: boolean
  error: string | null
}

export interface ComplianceReportSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The drafted report being submitted, or null when the dialog is closed. */
  report: ComplianceReport | null
}
