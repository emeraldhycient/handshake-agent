"use client"

/**
 * AddBlockedDialog — append an address/identifier to the sanctions denylist
 * (`compliance.sanctionsDenylist`). The store is a flat string[], so the design's
 * Reason field has no persisted home yet; it is captured for the audit-log note
 * only (the write goes through the layered-config API + immutable audit).
 *
 * react-hook-form + a local UI schema (there is no cross-boundary DTO for a single
 * denylist entry — the whole array is what the setting's schema validates
 * server-side). On submit the parent appends `value` to the current denylist and
 * persists the whole array through step-up-then-retry; this dialog awaits that
 * promise, surfaces any error inline, and closes on success. Focus-trapped,
 * Esc-closable via the Dialog primitive.
 */
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

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
import { ApiError } from "@/lib/api/client"
import type { AddBlockedDialogProps } from "@/types/components"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

// Local UI-only form schema (not a boundary DTO). `value` is the address/identifier
// to block; `reason` is captured for the audit note (design §6.7 Reason column).
const AddBlockedFormSchema = z.object({
  value: z.string().trim().min(1, "Enter an address or identifier"),
  reason: z.string().trim().max(280).optional(),
})
type AddBlockedForm = z.infer<typeof AddBlockedFormSchema>

export function AddBlockedDialog({
  open,
  onOpenChange,
  denylist,
  onSave,
}: AddBlockedDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AddBlockedForm>({
    resolver: zodResolver(AddBlockedFormSchema),
    defaultValues: { value: "", reason: "" },
  })

  // Re-seed the form whenever the dialog opens (drop any stale draft/error).
  useEffect(() => {
    if (open) reset({ value: "", reason: "" })
  }, [open, reset])

  function close() {
    reset({ value: "", reason: "" })
    onOpenChange(false)
  }

  async function onSubmit(values: AddBlockedForm) {
    const value = values.value.trim()
    if (denylist.includes(value)) {
      setError("value", {
        type: "duplicate",
        message: "This entry is already on the blocked list",
      })
      return
    }
    try {
      await onSave([...denylist, value])
      close()
    } catch (error) {
      setError("value", {
        type: "server",
        message: errorMessage(error) ?? "Could not add the entry",
      })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to the blocked list</DialogTitle>
          <DialogDescription>
            Block an address or identifier from sanctions screening. Nothing is
            deleted — this is recorded in the immutable audit log.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-4"
        >
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
            <Button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Adding…" : "Add entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
