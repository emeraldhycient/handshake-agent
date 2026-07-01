"use client"

/**
 * UsersBulkActions — the Users-directory bulk-bar WRITE actions over the current
 * selection (Phase 7): apply an operator TAG, or queue a templated MESSAGE.
 *
 * Neither moves money (§3.1): a tag is a pure annotation; a message references an
 * admin-authored template (the model never authors it) and enqueues onto the
 * notifications outbox — never a direct send. Both are step-up-guarded: we attempt
 * the mutation, and if it 403s with ADMIN_STEP_UP_REQUIRED we open the StepUpDialog;
 * after re-auth the stashed mutation is retried (`useStepUpRetry`). A large message
 * selection may 422 with ADMIN_BULK_CONFIRMATION_REQUIRED — the operator ticks the
 * confirm box and resubmits (the gate is re-checked server-side, §3.3).
 */
import { useState } from "react"
import { Tag as TagIcon, Send } from "lucide-react"
import {
  BulkMessageEventTypeSchema,
  type BulkMessageEventType,
} from "@handshake-agent/contracts"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAdminMe, useApplyUserTags, useSendBulkMessage } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import { pushToast } from "@/lib/store/toast-store"
import type { UsersBulkActionsProps } from "@/types/components"

const EVENT_TYPES = BulkMessageEventTypeSchema.options
const BULK_CONFIRM_CODE = "ADMIN_BULK_CONFIRMATION_REQUIRED"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

function isBulkConfirmError(error: unknown): boolean {
  return error instanceof ApiError && error.code === BULK_CONFIRM_CODE
}

export function UsersBulkActions({ selectedIds, onDone }: UsersBulkActionsProps) {
  const me = useAdminMe()
  const applyTags = useApplyUserTags()
  const sendMessage = useSendBulkMessage()
  const stepUp = useStepUpRetry()

  const [tagOpen, setTagOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tag form
  const [tag, setTag] = useState("")
  const [tagReason, setTagReason] = useState("")

  // Message form
  const [eventType, setEventType] = useState<BulkMessageEventType>(EVENT_TYPES[0])
  const [templateKey, setTemplateKey] = useState("")
  const [msgReason, setMsgReason] = useState("")
  const [confirmLargeSet, setConfirmLargeSet] = useState(false)

  const ids = [...selectedIds]
  const busy = applyTags.isPending || sendMessage.isPending

  function resetTag() {
    setTag("")
    setTagReason("")
    setError(null)
  }

  function resetMessage() {
    setEventType(EVENT_TYPES[0])
    setTemplateKey("")
    setMsgReason("")
    setConfirmLargeSet(false)
    setError(null)
  }

  async function submitTag() {
    setError(null)
    try {
      const done = await stepUp.run(() =>
        applyTags
          .mutateAsync({ userIds: ids, tag, reason: tagReason })
          .then((res) => {
            pushToast(`Tag "${res.tag}" applied to ${res.applied} users`, "ok")
            setTagOpen(false)
            resetTag()
            onDone()
          })
      )
      // A step-up challenge was raised — the StepUpDialog is now open; the retry
      // replays the same action on success.
      if (!done) return
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function submitMessage() {
    setError(null)
    try {
      const done = await stepUp.run(() =>
        sendMessage
          .mutateAsync({
            userIds: ids,
            eventType,
            templateKey,
            variables: {},
            reason: msgReason,
            confirmLargeSet,
          })
          .then((res) => {
            pushToast(`Broadcast queued to ${res.queued} users`, "info")
            setMessageOpen(false)
            resetMessage()
            onDone()
          })
      )
      if (!done) return
    } catch (err) {
      // A large selection needs an explicit confirmation — surface the checkbox
      // rather than a raw error, so the operator can acknowledge and resubmit.
      if (isBulkConfirmError(err)) {
        setConfirmLargeSet(false)
        setError(
          "This selection is over the large-set threshold. Tick “Confirm large broadcast” and resend."
        )
        return
      }
      setError(errorMessage(err))
    }
  }

  const mfaEnabled = me.data?.mfaEnabled ?? false

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetTag()
          setTagOpen(true)
        }}
        className="flex items-center gap-1.5 text-[12.5px] font-semibold opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      >
        <TagIcon size={13} aria-hidden />
        Tag
      </button>
      <button
        type="button"
        onClick={() => {
          resetMessage()
          setMessageOpen(true)
        }}
        className="flex items-center gap-1.5 text-[12.5px] font-semibold opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      >
        <Send size={13} aria-hidden />
        Message
      </button>

      {/* ── Tag dialog ─────────────────────────────────────────────────────────── */}
      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tag {ids.length} users</DialogTitle>
            <DialogDescription>
              Apply an operator tag to the selected users. Tags are annotations only
              — they never change a user&apos;s permissions or limits.
            </DialogDescription>
          </DialogHeader>

          {tagOpen && error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-tag">Tag</Label>
            <Input
              id="bulk-tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="e.g. vip"
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-tag-reason">Reason</Label>
            <Input
              id="bulk-tag-reason"
              value={tagReason}
              onChange={(e) => setTagReason(e.target.value)}
              placeholder="Why are you applying this tag?"
              disabled={busy}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTagOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={submitTag}
              disabled={busy || tag.trim() === "" || tagReason.trim() === ""}
              aria-busy={busy}
            >
              {applyTags.isPending ? "Applying…" : "Apply tag"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Message dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message {ids.length} users</DialogTitle>
            <DialogDescription>
              Queue a templated broadcast to the selected users. Choose an existing
              template — the message is dispatched through the notifications outbox.
            </DialogDescription>
          </DialogHeader>

          {messageOpen && error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-msg-event">Event type</Label>
            <NativeSelect
              id="bulk-msg-event"
              value={eventType}
              disabled={busy}
              onChange={(e) =>
                setEventType(e.target.value as BulkMessageEventType)
              }
            >
              {EVENT_TYPES.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-msg-template">Template key</Label>
            <Input
              id="bulk-msg-template"
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              placeholder="e.g. ops.balance_notice"
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-msg-reason">Reason</Label>
            <Input
              id="bulk-msg-reason"
              value={msgReason}
              onChange={(e) => setMsgReason(e.target.value)}
              placeholder="Why are you sending this?"
              disabled={busy}
            />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink2">
            <input
              type="checkbox"
              checked={confirmLargeSet}
              onChange={(e) => setConfirmLargeSet(e.target.checked)}
              disabled={busy}
              className="size-4"
            />
            Confirm large broadcast (required over the threshold)
          </label>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMessageOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={submitMessage}
              disabled={
                busy || templateKey.trim() === "" || msgReason.trim() === ""
              }
              aria-busy={busy}
            >
              {sendMessage.isPending ? "Queueing…" : "Queue broadcast"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={mfaEnabled}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp.retry().catch((err) => setError(errorMessage(err)))
        }}
      />
    </>
  )
}
