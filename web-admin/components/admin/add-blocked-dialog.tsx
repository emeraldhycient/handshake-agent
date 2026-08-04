"use client"

/**
 * AddBlockedDialog — append an address/identifier to the sanctions denylist
 * (`compliance.sanctionsDenylist`). Composition only: the RHF form + dup-check +
 * step-up-aware save flow live in `useAddBlockedForm`; the parent's `onSave`
 * persists the whole array through the layered-config API + immutable audit.
 * Nothing is deleted — an add is recorded, never a removal. Focus-trapped,
 * Esc-closable.
 */
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
import { useAddBlockedForm } from "@/lib/hooks/use-add-blocked-form"
import type { AddBlockedDialogProps } from "@/types"

export function AddBlockedDialog(props: AddBlockedDialogProps) {
  const { open, register, errors, isSubmitting, close, onFormSubmit, onDialogOpenChange } =
    useAddBlockedForm(props)

  return (
    <Dialog open={open} onOpenChange={onDialogOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to the blocked list</DialogTitle>
          <DialogDescription>
            Block an address or identifier from sanctions screening. Nothing is
            deleted — this is recorded in the immutable audit log.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onFormSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blocked-value">Value</Label>
            <Input
              id="blocked-value"
              aria-invalid={!!errors.value}
              placeholder="Address or identifier"
              disabled={isSubmitting}
              className="font-mono text-[12.5px]"
              {...register("value")}
            />
            {errors.value && (
              <p role="alert" className="text-[11.5px] font-semibold text-tdn">
                {errors.value.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blocked-reason">Reason</Label>
            <Input
              id="blocked-reason"
              aria-invalid={!!errors.reason}
              placeholder="Why this entry is blocked"
              disabled={isSubmitting}
              {...register("reason")}
            />
            {errors.reason && (
              <p role="alert" className="text-[11.5px] font-semibold text-tdn">
                {errors.reason.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? "Adding…" : "Add entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
