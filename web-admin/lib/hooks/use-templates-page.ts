"use client"

import { useState } from "react"
import type { NotificationTemplate } from "@handshake-agent/contracts"

import { useNotificationTemplates } from "@/lib/query/hooks"

/**
 * The templates page's data layer: the templates read plus the editor dialog state
 * (open + which template it targets, null → create mode). The editor itself is the
 * shared step-up-gated `TemplateEditorDialog`. Nothing here moves money (§3.1).
 */
export function useTemplatesPage() {
  const query = useNotificationTemplates()
  const templates = query.data?.items ?? []

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

  return {
    query,
    templates,
    editorOpen,
    setEditorOpen,
    editing,
    openCreate,
    openEdit,
  }
}
