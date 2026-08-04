"use client"

/**
 * InviteSuccess — the post-invite view: the one-time invitation token shown once
 * so the inviter can hand it to the invitee (it is never persisted in plaintext,
 * so this is the only chance to copy it). Presentation only.
 */
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import type { InviteSuccessProps } from "@/types"

export function InviteSuccess({ email, token, onDone }: InviteSuccessProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-ink2">
        Invitation created for{" "}
        <span className="font-bold text-ink">{email}</span>. Share this one-time
        token with them — it won&apos;t be shown again:
      </p>
      <code className="rounded-[10px] border border-line bg-field px-3 py-2 font-mono text-xs break-all text-ink">
        {token}
      </code>
      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  )
}
