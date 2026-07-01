"use client"

/**
 * ConversationLogDetail — the conversation drawer (a right-side Sheet, Phase 4).
 * Opened by the agent page's conversation list with a `conversationId`; fetches
 * the detail via `useConversation` and renders the inbound messages (each with
 * its processingStatus and the validated NLU intent: action + confidence) and the
 * agent replies (status + sentAt). Read-only — nothing here moves money or edits
 * the agent (§3.1).
 *
 * Four async branches on the detail query: loading / error / empty / data.
 */
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useConversation } from "@/lib/query/hooks"
import type { ConversationLogDetailProps } from "@/types/components"

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

export function ConversationLogDetail({
  conversationId,
  onOpenChange,
}: ConversationLogDetailProps) {
  const detail = useConversation(conversationId)
  const conversation = detail.data
  const isEmpty =
    detail.isSuccess &&
    conversation !== undefined &&
    conversation.messages.length === 0 &&
    conversation.replies.length === 0

  return (
    <Sheet open={conversationId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Conversation</SheetTitle>
          <SheetDescription>
            {conversation
              ? `${conversation.language} · ${conversation.status}`
              : "Loading conversation"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4 pt-0">
          {/* ── Loading ──────────────────────────────────────────────────── */}
          {detail.isLoading && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-24 w-full rounded-[16px]" />
              <Skeleton className="h-24 w-full rounded-[16px]" />
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {detail.isError && (
            <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
              <p className="text-sm font-semibold text-tdn">
                Failed to load this conversation
              </p>
              <p className="mt-1 text-xs text-ink3">Close and try again.</p>
            </div>
          )}

          {/* ── Empty ────────────────────────────────────────────────────── */}
          {isEmpty && (
            <div className="rounded-[16px] border border-line bg-card p-8 text-center">
              <p className="text-sm font-bold text-ink">Nothing to show</p>
              <p className="mt-1 text-[12.5px] text-ink3">
                No messages or replies in this conversation.
              </p>
            </div>
          )}

          {/* ── Data ─────────────────────────────────────────────────────── */}
          {detail.isSuccess && conversation && !isEmpty && (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase">
                  Messages
                </h3>
                {conversation.messages.length === 0 ? (
                  <p className="text-[12.5px] text-ink3">No messages.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {conversation.messages.map((message) => (
                      <li
                        key={message.id}
                        className="rounded-[14px] border border-line bg-card2 p-3"
                      >
                        <p className="text-[13px] text-ink">{message.text}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant="neutral">
                            {message.processingStatus}
                          </Badge>
                          {message.intent && (
                            <Badge variant="info">
                              intent: {message.intent.action}
                              {message.intent.confidence !== null
                                ? ` (${message.intent.confidence})`
                                : ""}
                            </Badge>
                          )}
                          <span className="font-mono text-[11px] text-ink3 tabular-nums">
                            {formatDate(message.receivedAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <Separator />

              <section className="flex flex-col gap-2">
                <h3 className="text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase">
                  Replies
                </h3>
                {conversation.replies.length === 0 ? (
                  <p className="text-[12.5px] text-ink3">No replies.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {conversation.replies.map((reply) => (
                      <li
                        key={reply.id}
                        className="rounded-[14px] border border-line bg-card p-3"
                      >
                        <p className="text-[13px] text-ink">{reply.text}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant="neutral">{reply.status}</Badge>
                          <span className="font-mono text-[11px] text-ink3 tabular-nums">
                            {formatDate(reply.sentAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
