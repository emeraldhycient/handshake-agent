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
import type { BulkTagDialogProps } from "@/types/components"

/**
 * The bulk TAG dialog — applies an operator tag (annotation only; never changes
 * permissions or limits) over the selection. Submit is step-up-gated in the hook.
 */
export function BulkTagDialog({ tag, ids, error, busy }: BulkTagDialogProps) {
  return (
    <Dialog open={tag.open} onOpenChange={tag.setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tag {ids.length} users</DialogTitle>
          <DialogDescription>
            Apply an operator tag to the selected users. Tags are annotations
            only — they never change a user&apos;s permissions or limits.
          </DialogDescription>
        </DialogHeader>

        {/* The error state is shared across both dialogs; scope it to this open
            dialog (matching the original `tagOpen && error` guard). */}
        {tag.open && error && (
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
            value={tag.value}
            onChange={(e) => tag.setValue(e.target.value)}
            placeholder="e.g. vip"
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-tag-reason">Reason</Label>
          <Input
            id="bulk-tag-reason"
            value={tag.reason}
            onChange={(e) => tag.setReason(e.target.value)}
            placeholder="Why are you applying this tag?"
            disabled={busy}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => tag.setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={tag.submit}
            disabled={
              busy || tag.value.trim() === "" || tag.reason.trim() === ""
            }
            aria-busy={busy}
          >
            {tag.applying ? "Applying…" : "Apply tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
