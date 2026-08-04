"use client"

import { useState, type ReactNode } from "react"

import type { ConversationLogItem } from "@handshake-agent/contracts"

import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/shared/data-table"
import { ConversationLogDetail } from "@/components/admin/conversation-log-detail"
import { useConversations } from "@/lib/query/hooks"
import type { DataTableColumn } from "@/types"

import { CardError, CardShell, CardSkeleton } from "./agent-card-shells"

/** Compact locale date-time for the last-activity column ("—" when never). */
function formatWhen(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

/** Short mono handle for a uuid/contact id (full ids are drawer detail). */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

/**
 * Conversations — the conversation/intent log section (Phase 4 read, restored
 * after the operator-console re-skin dropped it). WIRED to the real
 * GET /admin/agent/conversations list; a row's View opens the read-only
 * ConversationLogDetail drawer (messages + validated NLU intents + replies).
 * Read-only — nothing here edits the agent or moves money (§3.1). Four async
 * branches (§5).
 */
export function ConversationsCard() {
  const conversations = useConversations()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const shell = (children: ReactNode) => (
    <CardShell title="Conversations" suffix="· intent log (read-only)">
      {children}
    </CardShell>
  )

  if (conversations.isLoading) return shell(<CardSkeleton />)
  if (conversations.isError) {
    return shell(
      <CardError
        label="Couldn't load conversations"
        onRetry={() => void conversations.refetch()}
      />
    )
  }

  const items = conversations.data?.items ?? []

  // Column config carries JSX renderers, so it stays in the section file (§16.5).
  const columns: DataTableColumn<ConversationLogItem>[] = [
    {
      key: "party",
      header: "User / contact",
      render: (row) => (
        <span className="font-mono text-xs font-semibold text-ink">
          {row.userId
            ? shortId(row.userId)
            : row.contactId
              ? shortId(row.contactId)
              : "—"}
        </span>
      ),
    },
    {
      key: "language",
      header: "Language",
      render: (row) => (
        <span className="text-[12.5px] text-ink2">{row.language}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge variant="neutral">{row.status}</Badge>,
    },
    {
      key: "last",
      header: "Last message",
      render: (row) => (
        <span className="font-mono text-[11.5px] text-ink3 tabular-nums">
          {formatWhen(row.lastMessageAt ?? row.createdAt)}
        </span>
      ),
    },
    {
      key: "view",
      header: "",
      align: "right",
      render: (row) => (
        <button
          type="button"
          onClick={() => setSelectedId(row.id)}
          aria-label={`View conversation ${shortId(row.id)}`}
          className="rounded-[9px] border border-line bg-card px-3 py-1.5 text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          View
        </button>
      ),
    },
  ]

  return shell(
    <>
      <DataTable
        ariaLabel="Agent conversations"
        columns={columns}
        rows={items}
        getRowKey={(row) => row.id}
        empty={
          <p className="py-2 text-[12.5px] text-ink3">
            No conversations yet. Web and WhatsApp agent threads appear here
            once users start chatting.
          </p>
        }
      />
      <ConversationLogDetail
        conversationId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      />
    </>
  )
}
