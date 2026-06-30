"use client"

/**
 * AgentPage — the embedded-agent oversight surface (Phase 4). A read-only config
 * card (modelId, enabled badge, systemPromptPreview in a <pre>) above the
 * conversation/intent log list. The model id + enablement flag are tuned on the
 * Settings page (Agent category); the SYSTEM PROMPT is read-only (a preview only —
 * never editable, §3.1/§6). The ANTHROPIC_API_KEY is never surfaced.
 *
 * Each section is an independent query with its own four async branches (loading /
 * error / empty / data). Selecting a conversation opens the ConversationLogDetail
 * drawer.
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
import { Skeleton } from "@/components/ui/skeleton"
import { ConversationLogDetail } from "@/components/admin/conversation-log-detail"
import { useAgentConfig, useConversations } from "@/lib/query/hooks"

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  )
}

// ─── Config card ──────────────────────────────────────────────────────────────────

function ConfigCard() {
  const config = useAgentConfig()

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
        Configuration
      </h2>

      <div
        role="note"
        className="rounded-[14px] border border-info/30 bg-info/5 px-4 py-3 text-sm text-info-foreground"
      >
        The model id and enablement are edited on the{" "}
        <a href="/settings" className="font-medium underline">
          Settings page
        </a>{" "}
        (Agent category); the system prompt is not editable.
      </div>

      {config.isLoading && (
        <div aria-busy="true">
          <Skeleton className="h-40 w-full rounded-md" />
        </div>
      )}

      {config.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load agent config
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {config.isSuccess && !config.data && (
        <p className="text-sm text-muted-foreground">No agent config found.</p>
      )}

      {config.isSuccess && config.data && (
        <div className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 border-b border-border/60 py-1.5">
              <dt className="text-muted-foreground">Model ID</dt>
              <dd className="font-mono text-xs text-foreground">
                {config.data.modelId}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-border/60 py-1.5">
              <dt className="text-muted-foreground">Enabled</dt>
              <dd>
                {config.data.enabled ? (
                  <Badge variant="default">on</Badge>
                ) : (
                  <Badge variant="outline">off</Badge>
                )}
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
              System prompt (read-only)
            </p>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] whitespace-pre-wrap text-muted-foreground">
              {config.data.systemPromptPreview}
            </pre>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Conversation list ──────────────────────────────────────────────────────────────

function ConversationList({ onOpen }: { onOpen: (id: string) => void }) {
  const conversations = useConversations()

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
        Conversation logs
      </h2>

      {conversations.isLoading && <LoadingRows />}

      {conversations.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load conversations
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {conversations.isSuccess && conversations.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No conversations yet.</p>
      )}

      {conversations.isSuccess && conversations.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conversation</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conversations.data.items.map((item) => (
                <TableRow
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open conversation ${item.id.slice(0, 8)}`}
                  className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() => onOpen(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onOpen(item.id)
                    }
                  }}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.id.slice(0, 8)}…
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.userId ? `${item.userId.slice(0, 8)}…` : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.language}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.status}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDate(item.lastMessageAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export function AgentPage() {
  const [conversationId, setConversationId] = useState<string | null>(null)

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Agent
        </h1>
      </div>

      <ConfigCard />
      <ConversationList onOpen={setConversationId} />

      <ConversationLogDetail
        conversationId={conversationId}
        onOpenChange={(open) => {
          if (!open) setConversationId(null)
        }}
      />
    </div>
  )
}
