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
 *
 * Presentation follows the operator-console design (§6.17 Agent config): a page
 * header whose subtitle reads "Tools propose, never execute.", a `1fr 1fr` row of
 * read-mostly **Model & guardrails** key/val + read-only **System prompt** cards,
 * then the **Conversation logs** table. Tools propose, never execute (§3.1).
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
      <Skeleton className="h-12 w-full rounded-[16px]" />
      <Skeleton className="h-12 w-full rounded-[16px]" />
      <Skeleton className="h-12 w-full rounded-[16px]" />
    </div>
  )
}

// ─── Config cards ─────────────────────────────────────────────────────────────────

function ConfigCards() {
  const config = useAgentConfig()

  // ── Loading ──────────────────────────────────────────────────────────────
  if (config.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2" aria-busy="true">
        <Skeleton className="h-52 w-full rounded-2xl" />
        <Skeleton className="h-52 w-full rounded-2xl" />
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (config.isError) {
    return (
      <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
        <p className="text-sm font-semibold text-tdn">
          Failed to load agent config
        </p>
        <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
      </div>
    )
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (config.isSuccess && !config.data) {
    return (
      <div className="rounded-[16px] border border-line bg-card p-12 text-center">
        <p className="text-sm font-bold text-ink">No agent config found</p>
        <p className="mt-1 text-[12.5px] text-ink3">
          The embedded agent has not been configured.
        </p>
      </div>
    )
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  if (!config.isSuccess || !config.data) return null
  const { modelId, enabled, systemPromptPreview } = config.data

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      {/* Model & guardrails — read-mostly key/val */}
      <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
        <div className="mb-3 text-[13px] font-extrabold text-ink">
          Model &amp; guardrails{" "}
          <span className="font-semibold text-ink3">· read-mostly</span>
        </div>

        <div className="flex items-center justify-between border-b border-line2 py-[9px]">
          <span className="text-[12.5px] text-ink2">Model ID</span>
          <span className="font-mono text-[12px] font-bold text-ink">
            {modelId}
          </span>
        </div>
        <div className="flex items-center justify-between border-b border-line2 py-[9px] last:border-b-0">
          <span className="text-[12.5px] text-ink2">Enabled</span>
          {enabled ? (
            <Badge variant="success">on</Badge>
          ) : (
            <Badge variant="neutral">off</Badge>
          )}
        </div>

        <p className="mt-3 text-[11.5px] text-ink3">
          Model id and enablement are edited on the{" "}
          <a href="/settings" className="font-semibold text-tif underline">
            Settings page
          </a>{" "}
          (Agent category). Tools <b>propose</b>, never execute.
        </p>
      </div>

      {/* System prompt — read-only preview */}
      <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13px] font-extrabold text-ink">
            System prompt
          </div>
          <span className="text-[11px] text-ink3">read-only</span>
        </div>
        <pre className="max-h-64 overflow-auto rounded-[12px] border border-line bg-field p-3 font-mono text-[11px] whitespace-pre-wrap text-ink2">
          {systemPromptPreview}
        </pre>
      </div>
    </div>
  )
}

// ─── Conversation list ──────────────────────────────────────────────────────────────

function ConversationList({ onOpen }: { onOpen: (id: string) => void }) {
  const conversations = useConversations()

  return (
    <section className="flex flex-col gap-3">
      <div className="text-[13px] font-extrabold text-ink">
        Conversation logs
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {conversations.isLoading && <LoadingRows />}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {conversations.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
          <p className="text-sm font-semibold text-tdn">
            Failed to load conversations
          </p>
          <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {conversations.isSuccess && conversations.data.items.length === 0 && (
        <div className="rounded-[16px] border border-line bg-card p-12 text-center">
          <p className="text-sm font-bold text-ink">No conversations yet</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            Agent conversation logs will appear here.
          </p>
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {conversations.isSuccess && conversations.data.items.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-line bg-card">
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
                  className="cursor-pointer focus-visible:bg-hov focus-visible:outline-none"
                  onClick={() => onOpen(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onOpen(item.id)
                    }
                  }}
                >
                  <TableCell className="font-mono text-[11.5px] text-ink2">
                    {item.id.slice(0, 8)}…
                  </TableCell>
                  <TableCell className="font-mono text-[11.5px] text-ink3">
                    {item.userId ? `${item.userId.slice(0, 8)}…` : "—"}
                  </TableCell>
                  <TableCell className="text-ink2">{item.language}</TableCell>
                  <TableCell className="text-ink2">{item.status}</TableCell>
                  <TableCell className="font-mono text-[11px] text-ink3 tabular-nums">
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
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-4 overflow-y-auto px-6 py-6 sm:px-8">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          Agent config
        </h1>
        <p className="mt-1 text-[13.5px] text-ink2">
          LLM runtime, prompt and conversation oversight. Tools <b>propose</b>,
          never execute.
        </p>
      </div>

      <ConfigCards />
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
