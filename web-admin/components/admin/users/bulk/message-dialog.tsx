import type { BulkMessageEventType } from "@handshake-agent/contracts"

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
import { EVENT_TYPES } from "@/constants/users-bulk"
import type { BulkMessageDialogProps } from "@/types/components"

/**
 * The bulk MESSAGE dialog — queues a templated broadcast (through the notifications
 * outbox, never a direct send) over the selection. A large set requires ticking the
 * confirm box; submit is step-up-gated in the hook.
 */
export function BulkMessageDialog({
  message,
  ids,
  error,
  busy,
}: BulkMessageDialogProps) {
  return (
    <Dialog open={message.open} onOpenChange={message.setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message {ids.length} users</DialogTitle>
          <DialogDescription>
            Queue a templated broadcast to the selected users. Choose an
            existing template — the message is dispatched through the
            notifications outbox.
          </DialogDescription>
        </DialogHeader>

        {/* The error state is shared across both dialogs; scope it to this open
            dialog (matching the original `messageOpen && error` guard). */}
        {message.open && error && (
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
            value={message.eventType}
            disabled={busy}
            onChange={(e) =>
              message.setEventType(e.target.value as BulkMessageEventType)
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
            value={message.templateKey}
            onChange={(e) => message.setTemplateKey(e.target.value)}
            placeholder="e.g. ops.balance_notice"
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-msg-reason">Reason</Label>
          <Input
            id="bulk-msg-reason"
            value={message.reason}
            onChange={(e) => message.setReason(e.target.value)}
            placeholder="Why are you sending this?"
            disabled={busy}
          />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink2">
          <input
            type="checkbox"
            checked={message.confirmLargeSet}
            onChange={(e) => message.setConfirmLargeSet(e.target.checked)}
            disabled={busy}
            className="size-4"
          />
          Confirm large broadcast (required over the threshold)
        </label>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => message.setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={message.submit}
            disabled={
              busy ||
              message.templateKey.trim() === "" ||
              message.reason.trim() === ""
            }
            aria-busy={busy}
          >
            {message.queueing ? "Queueing…" : "Queue broadcast"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
