"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/shared/form-field"
import { useChangePin } from "@/lib/query/profile"
import {
  ChangePinFormSchema,
  type ChangePinFormValues,
} from "@/lib/schemas/settings"
import { pinErrorMessage } from "@/lib/settings/pin-error"
import type { ChangePinDialogProps } from "@/types"

const PIN_INPUT_PROPS = {
  type: "password",
  inputMode: "numeric",
  autoComplete: "off",
  maxLength: 6,
} as const

/**
 * Change the transaction PIN. The current PIN is verified server-side through
 * the lockout-protected PinService; errors branch on the API's stable codes so
 * "wrong PIN" and "locked" read differently (never a vague catch-all).
 */
export function ChangePinDialog({ open, onOpenChange }: ChangePinDialogProps) {
  const changePin = useChangePin()
  const [succeeded, setSucceeded] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePinFormValues>({
    resolver: zodResolver(ChangePinFormSchema),
  })

  async function onSubmit(values: ChangePinFormValues) {
    setServerError(null)
    try {
      await changePin.mutateAsync({
        currentPin: values.currentPin,
        newPin: values.newPin,
      })
      setSucceeded(true)
      reset()
    } catch (err) {
      setServerError(pinErrorMessage(err))
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSucceeded(false)
      setServerError(null)
      reset()
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change transaction PIN</DialogTitle>
          <DialogDescription>
            Your PIN authorizes every money movement. Choose 4–6 digits that
            are hard to guess.
          </DialogDescription>
        </DialogHeader>
        {succeeded ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold text-success" role="status">
              PIN updated. Use your new PIN for your next transaction.
            </p>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <FormField
              id="current-pin"
              label="Current PIN"
              error={errors.currentPin?.message}
              {...PIN_INPUT_PROPS}
              {...register("currentPin")}
            />
            <FormField
              id="new-pin"
              label="New PIN"
              hint="4–6 digits; not all the same digit or a simple sequence."
              error={errors.newPin?.message}
              {...PIN_INPUT_PROPS}
              {...register("newPin")}
            />
            <FormField
              id="confirm-new-pin"
              label="Confirm new PIN"
              error={errors.confirmNewPin?.message}
              {...PIN_INPUT_PROPS}
              {...register("confirmNewPin")}
            />
            {serverError && (
              <p className="text-[12.5px] text-danger" role="alert">
                {serverError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={changePin.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={changePin.isPending}>
                {changePin.isPending ? "Updating…" : "Update PIN"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
