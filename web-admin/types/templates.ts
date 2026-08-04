/** Message templates page and the template editor dialog. */

import type { NotificationTemplate } from "@handshake-agent/contracts"

// ─── Notifications page (Phase 4) ──────────────────────────────────────────────────

export interface TemplateEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing template, or null to create a new one. */
  template: NotificationTemplate | null
}

/** The variables editor — name / type / description rows with add + remove. */
export interface VariablesEditorProps {
  variables: import("@handshake-agent/contracts").TemplateVariable[]
  onChange: (
    next: import("@handshake-agent/contracts").TemplateVariable[]
  ) => void
  disabled: boolean
}

/** The live-preview panel — sample-vars JSON input + Preview + rendered output. */
export interface PreviewPanelProps {
  contentText: string
  subject: string
  disabled: boolean
}

/** The template create/edit form body — mounted only while the dialog is open. */
export interface TemplateFormProps {
  template: NotificationTemplate | null
  onClose: () => void
}

// ─── Templates page (design §6.19) ──────────────────────────────────────────────────
// The Templates screen is WIRED to the real GET /admin/notification-templates
// endpoint (Phase 6a) and maps the contract's `NotificationTemplate` directly onto
// each card. The design's approval pill has no backing contract field and is omitted
// (recorded as a shape gap). Create/edit is the shared step-up-gated TemplateEditorDialog.

/** One template preview card — channel chip · mono name · Edit · locale/vars · body. */
export interface TemplateCardProps {
  template: import("@handshake-agent/contracts").NotificationTemplate
  onEdit: (
    template: import("@handshake-agent/contracts").NotificationTemplate
  ) => void
}

/** The template preview grid — the four async branches over the templates read. */
export interface TemplatesGridProps {
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  templates: readonly import("@handshake-agent/contracts").NotificationTemplate[]
  onEdit: (
    template: import("@handshake-agent/contracts").NotificationTemplate
  ) => void
  onRetry: () => void
}
