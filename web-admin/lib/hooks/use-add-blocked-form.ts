"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import {
  ADD_BLOCKED_DEFAULTS,
  AddBlockedFormSchema,
  type AddBlockedForm,
} from "@/lib/blocked/add-blocked-schema"
import { toErrorMessage } from "@/lib/error-message"
import type { AddBlockedDialogProps } from "@/types/components"

/**
 * View-model for the "Add to the blocked list" dialog. Owns the RHF form (value +
 * reason), re-seeds it on each open, and on submit appends the trimmed value to the
 * current denylist and persists the whole array via the parent's `onSave` (which
 * runs the step-up-then-retry write, §3.3). A duplicate is rejected inline before
 * any request; a server error is surfaced on the `value` field. Closes on success.
 */
export function useAddBlockedForm({
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
    defaultValues: ADD_BLOCKED_DEFAULTS,
  })

  // Re-seed the form whenever the dialog opens (drop any stale draft/error).
  useEffect(() => {
    if (open) reset(ADD_BLOCKED_DEFAULTS)
  }, [open, reset])

  function close() {
    reset(ADD_BLOCKED_DEFAULTS)
    onOpenChange(false)
  }

  const onFormSubmit = handleSubmit(async (values) => {
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
        message: toErrorMessage(error) ?? "Could not add the entry",
      })
    }
  })

  return {
    open,
    register,
    errors,
    isSubmitting,
    close,
    onFormSubmit,
    onDialogOpenChange: (next: boolean) => (next ? onOpenChange(true) : close()),
  }
}
