"use client"

/**
 * UsersBulkActions — the Users-directory bulk-bar WRITE actions over the current
 * selection (Phase 7): apply an operator TAG, or queue a templated MESSAGE. Composition
 * only: `useUsersBulkActions` owns both dialogs' form state + the step-up / bulk-confirm
 * gates; the dialogs live in `components/admin/users/bulk/*`.
 *
 * Neither moves money (§3.1): a tag is a pure annotation; a message references an
 * admin-authored template and enqueues onto the notifications outbox (never a direct
 * send). Both are step-up-guarded (403 → StepUpDialog → replay); a large message set
 * 422s until the operator ticks the confirm box (re-checked server-side, §3.3).
 */
import { Tag as TagIcon, Send } from "lucide-react"

import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { BulkTagDialog } from "@/components/admin/users/bulk/tag-dialog"
import { BulkMessageDialog } from "@/components/admin/users/bulk/message-dialog"
import { useUsersBulkActions } from "@/lib/hooks/use-users-bulk-actions"
import type { UsersBulkActionsProps } from "@/types/components"

export function UsersBulkActions({
  selectedIds,
  onDone,
}: UsersBulkActionsProps) {
  const b = useUsersBulkActions({ selectedIds, onDone })

  return (
    <>
      <button
        type="button"
        onClick={b.openTag}
        className="flex items-center gap-1.5 text-[12.5px] font-semibold opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      >
        <TagIcon size={13} aria-hidden />
        Tag
      </button>
      <button
        type="button"
        onClick={b.openMessage}
        className="flex items-center gap-1.5 text-[12.5px] font-semibold opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      >
        <Send size={13} aria-hidden />
        Message
      </button>

      <BulkTagDialog tag={b.tag} ids={b.ids} error={b.error} busy={b.busy} />
      <BulkMessageDialog
        message={b.message}
        ids={b.ids}
        error={b.error}
        busy={b.busy}
      />

      <StepUpDialog
        open={b.stepUp.open}
        mfaEnabled={b.mfaEnabled}
        onOpenChange={b.stepUp.setOpen}
        onSuccess={b.onStepUpSuccess}
      />
    </>
  )
}
