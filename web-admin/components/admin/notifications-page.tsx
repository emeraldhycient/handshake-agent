"use client"

/**
 * NotificationsPage — the Comms console's notification-template management surface
 * (Phase 4). A responsive grid of template cards (channel chip + mono
 * templateKey + approval pill; locale/vars line; a content-text preview in a
 * `bg-card2` inset box). A "New template" button and a per-card Edit both open
 * the TemplateEditorDialog (which carries a live-preview panel). Create / edit
 * are step-up-gated inside the dialog.
 *
 * Presentation follows the operator-console design system §6.19 (Templates).
 *
 * Four async branches: loading / error / empty / data.
 */
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TemplateEditorDialog } from "@/components/admin/template-editor-dialog"
import { useNotificationTemplates } from "@/lib/query/hooks"
import type {
  NotificationChannel,
  NotificationTemplate,
} from "@handshake-agent/contracts"

/** Human label for the channel chip (design shows the channel verbatim). */
const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "SMS",
  in_app: "In-app",
}

/**
 * Approval-pill meta. WhatsApp templates require Meta template approval before
 * they can send; other channels are simply active. Absent a persisted approval
 * status on the contract, we derive it from the channel — WhatsApp templates that
 * carry a `whatsappTemplateId` are "Approved", otherwise "Pending review".
 */
function approvalMeta(template: NotificationTemplate): {
  label: string
  variant: "success" | "warn"
} {
  if (template.channel === "whatsapp") {
    return template.whatsappTemplateId
      ? { label: "Approved", variant: "success" }
      : { label: "Pending review", variant: "warn" }
  }
  return { label: "Active", variant: "success" }
}

function LoadingCards() {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[128px] w-full rounded-2xl" />
      ))}
    </div>
  )
}

function TemplateCard({
  template,
  onEdit,
}: {
  template: NotificationTemplate
  onEdit: () => void
}) {
  const approval = approvalMeta(template)
  const preview = template.contentText.trim()

  return (
    <div className="rounded-2xl border border-line bg-card p-[18px_20px]">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="shrink-0 rounded-md bg-card2 px-2.5 py-[3px] text-[11px] font-bold text-ink2">
          {CHANNEL_LABEL[template.channel]}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-bold text-ink">
          {template.templateKey}
        </span>
        <Badge variant={approval.variant}>{approval.label}</Badge>
      </div>

      <div className="mb-2 text-[11px] text-ink3">
        locale {template.language} · vars: {template.variables.length}
      </div>

      <div className="rounded-[10px] bg-card2 px-[13px] py-[11px] text-xs leading-relaxed text-ink2">
        {preview.length > 0 ? (
          <span className="line-clamp-3 whitespace-pre-wrap">{preview}</span>
        ) : (
          <span className="text-ink3 italic">No content text.</span>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={onEdit}
          aria-label={`Edit template ${template.templateKey}`}
        >
          Edit
        </Button>
      </div>
    </div>
  )
}

export function NotificationsPage() {
  const templates = useNotificationTemplates()
  const [editing, setEditing] = useState<NotificationTemplate | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  function openNew() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(template: NotificationTemplate) {
    setEditing(template)
    setDialogOpen(true)
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
              Templates
            </h1>
            <p className="mt-[5px] text-[13.5px] text-ink2">
              Email (Resend) and WhatsApp approved-template management.
            </p>
          </div>
          <Button size="sm" onClick={openNew}>
            New template
          </Button>
        </div>

        {/* ── Loading ─────────────────────────────────────────────────────── */}
        {templates.isLoading && <LoadingCards />}

        {/* ── Error ───────────────────────────────────────────────────────── */}
        {templates.isError && (
          <div className="rounded-2xl border border-line bg-sdn/40 p-6 text-center">
            <p className="text-sm font-bold text-tdn">
              Failed to load templates
            </p>
            <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
          </div>
        )}

        {/* ── Empty ───────────────────────────────────────────────────────── */}
        {templates.isSuccess && templates.data.items.length === 0 && (
          <div className="rounded-2xl border border-line bg-card px-6 py-12 text-center">
            <p className="text-sm font-bold text-ink">No templates yet</p>
            <p className="mt-1 text-[12.5px] text-ink3">
              Create one to get started.
            </p>
          </div>
        )}

        {/* ── Data ────────────────────────────────────────────────────────── */}
        {templates.isSuccess && templates.data.items.length > 0 && (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {templates.data.items.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onEdit={() => openEdit(template)}
              />
            ))}
          </div>
        )}

        <TemplateEditorDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          template={editing}
        />
      </div>
    </div>
  )
}
