"use client"

/**
 * NotificationsPage — the Comms console's notification-template management surface
 * (Phase 4). A table of templates (templateKey / language / channel + a variable
 * count); a "New template" button and a per-row Edit both open the
 * TemplateEditorDialog (which carries a live-preview panel). Create / edit are
 * step-up-gated inside the dialog.
 *
 * Four async branches: loading / error / empty / data.
 */
import { useState } from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TemplateEditorDialog } from "@/components/admin/template-editor-dialog"
import { useNotificationTemplates } from "@/lib/query/hooks"
import type { NotificationTemplate } from "@handshake-agent/contracts"

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
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
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Notification templates
        </h1>
        <Button size="sm" onClick={openNew}>
          New template
        </Button>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {templates.isLoading && <LoadingRows />}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {templates.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load templates
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────────── */}
      {templates.isSuccess && templates.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No templates yet. Create one to get started.
        </p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────────── */}
      {templates.isSuccess && templates.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template key</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Variables</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.data.items.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-mono text-xs text-foreground">
                    {template.templateKey}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {template.language}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{template.channel}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {template.variables.length}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(template)}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TemplateEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={editing}
      />
    </div>
  )
}
