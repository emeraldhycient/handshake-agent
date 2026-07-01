"use client"

/**
 * TemplatesPage — the Configuration group's notification-template screen
 * (operator-console design system §6.19, `docs/design-ref/screens/Templates.html`).
 *
 * Reproduces the design 1:1: a `1fr 1fr` grid of template preview cards, each
 * carrying a channel chip (status-token color pair) + mono template name, a
 * `locale · vars` line, and a body preview inset in a `bg-card2` box. Email
 * (Resend) + WhatsApp approved-template management.
 *
 * DATA (Phase 6a): wired to `GET /admin/notification-templates` via
 * `useNotificationTemplates()`. Each `NotificationTemplate` maps onto the design
 * card — `templateKey` → name, `language` → locale, `variables.length` → vars,
 * `contentText` → body preview, `channel` → the channel chip. Four async branches:
 * loading skeletons / error (inline retry) / empty / data.
 *
 * WRITE (Phase 7): a "New template" header button and a per-card Edit affordance open
 * the shared `TemplateEditorDialog`, which drives create (POST) / edit (PATCH) through
 * `useUpsertTemplate` with a deterministic live preview. Those mutations are sensitive
 * — a 403 ADMIN_STEP_UP_REQUIRED opens the step-up dialog and replays after re-auth
 * (`useStepUpRetry`) — and on success invalidate the templates list so the grid
 * re-resolves. Nothing here moves money (§3.1).
 *
 * SHAPE GAP: the design's approval pill (Approved/Pending/Rejected) has NO backing
 * field on `NotificationTemplate` (no approval/status), so it is omitted here and
 * recorded for the later backend-enrichment pass — no data is invented.
 */
import { useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { TemplateEditorDialog } from "@/components/admin/template-editor-dialog"
import { cn } from "@/lib/utils"
import { useNotificationTemplates } from "@/lib/query/hooks"
import type {
  NotificationChannel,
  NotificationTemplate,
} from "@handshake-agent/contracts"

// ─── Token maps (§5 status→token pairs) ─────────────────────────────────────────────

/**
 * Channel chip → status-token surface + text pair. The design surfaces WhatsApp
 * (success) + Email (info); the contract's `NotificationChannel` also carries SMS
 * (warn) and in-app (neutral), rendered gracefully with the same token vocabulary.
 */
const CHANNEL_CLASS: Record<NotificationChannel, string> = {
  whatsapp: "bg-sok text-tok",
  email: "bg-sif text-tif",
  sms: "bg-swn text-twn",
  in_app: "bg-card2 text-ink2",
}

/** Human channel label for the chip (contract enum → design casing). */
const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "SMS",
  in_app: "In-app",
}

// ─── Sub-components ─────────────────────────────────────────────────────────────────

/**
 * One template preview card — matches the Templates.html markup exactly: a header
 * row (channel chip · mono name · Edit), a `locale · vars` meta line, and a body
 * preview inset in a `bg-card2` box. Edit opens the shared editor for this template.
 */
function TemplateCard({
  template,
  onEdit,
}: {
  template: NotificationTemplate
  onEdit: (template: NotificationTemplate) => void
}) {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
      {/* ── Header row: channel chip · mono name · Edit ─────────────────────── */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          className={cn(
            "shrink-0 rounded-md px-[9px] py-[3px] text-[11px] font-bold",
            CHANNEL_CLASS[template.channel]
          )}
        >
          {CHANNEL_LABEL[template.channel]}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-bold text-ink">
          {template.templateKey}
        </span>
        <button
          type="button"
          onClick={() => onEdit(template)}
          aria-label={`Edit ${template.templateKey}`}
          className="shrink-0 rounded-[9px] border border-line bg-card px-3 py-[6px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Edit
        </button>
      </div>

      {/* ── locale · vars line ──────────────────────────────────────────────── */}
      <div className="mb-2 text-[11px] text-ink3">
        locale {template.language} · vars: {template.variables.length}
      </div>

      {/* ── Body preview inset (bg-card2) ───────────────────────────────────── */}
      <div className="rounded-[10px] bg-card2 px-[13px] py-[11px] text-[12px] leading-[1.5] text-ink2">
        {template.contentText}
      </div>
    </div>
  )
}

/** Loading branch — a grid of card-shaped skeletons matching the design layout. */
function TemplatesLoading() {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[152px] rounded-[16px]" />
      ))}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export function TemplatesPage() {
  const query = useNotificationTemplates()
  const templates = query.data?.items ?? []

  // The editor dialog: open + which template it targets (null → create mode).
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<NotificationTemplate | null>(null)

  function openCreate() {
    setEditing(null)
    setEditorOpen(true)
  }

  function openEdit(template: NotificationTemplate) {
    setEditing(template)
    setEditorOpen(true)
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
              Templates
            </h1>
            <p className="mt-[5px] text-[13.5px] text-ink2">
              Email (Resend) and WhatsApp approved-template management.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="shrink-0 rounded-[10px] bg-btn-dark px-3.5 py-2 text-[12.5px] font-extrabold text-white transition-colors hover:bg-btn-dark/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            New template
          </button>
        </div>

        {/* ── Loading ──────────────────────────────────────────────────────── */}
        {query.isLoading && <TemplatesLoading />}

        {/* ── Error (inline retry) ─────────────────────────────────────────── */}
        {query.isError && (
          <div className="rounded-[16px] border border-sdn bg-sdn/40 p-6 text-center">
            <p className="text-sm font-bold text-tdn">
              Couldn&apos;t load templates
            </p>
            <p className="mt-1 text-[12.5px] text-ink2">Please try again.</p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="mt-3 rounded-[10px] border border-line bg-card px-3.5 py-1.5 text-[12.5px] font-bold text-ink transition-colors hover:bg-card2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Empty ────────────────────────────────────────────────────────── */}
        {query.isSuccess && templates.length === 0 && (
          <div className="rounded-[16px] border border-line bg-card p-10 text-center">
            <p className="text-[13.5px] font-bold text-ink">No templates yet</p>
            <p className="mt-1 text-[12.5px] text-ink2">
              Email and WhatsApp templates you create will appear here.
            </p>
          </div>
        )}

        {/* ── Data: 1fr 1fr grid of template preview cards ──────────────────── */}
        {query.isSuccess && templates.length > 0 && (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onEdit={openEdit}
              />
            ))}
          </div>
        )}
      </div>

      {/* Shared create/edit editor (POST/PATCH via useUpsertTemplate + step-up). */}
      <TemplateEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        template={editing}
      />
    </div>
  )
}
