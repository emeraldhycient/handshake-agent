"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { toErrorMessage } from "@/lib/error-message"
import {
  AddCurrencyFormSchema,
  ADD_CURRENCY_DEFAULTS,
  type AddCurrencyForm,
} from "@/lib/currencies/add-currency-schema"
import type { AddCurrencyDialogProps } from "@/types/components"

/**
 * The add-currency form state: an RHF form validated by `AddCurrencyFormSchema`, re-seeded
 * on open. On submit it fast-rejects a duplicate code locally (ahead of the server's 409),
 * then awaits the parent's `onSave` (which owns the step-up-gated write) and closes on
 * success, surfacing any error inline on the code field. Nothing here moves money (§3.1).
 */
export function useAddCurrencyForm({
  open,
  existingCodes,
  onSave,
  onOpenChange,
}: AddCurrencyDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AddCurrencyForm>({
    resolver: zodResolver(AddCurrencyFormSchema),
    defaultValues: ADD_CURRENCY_DEFAULTS,
  })

  // Re-seed the form whenever the dialog opens (drop any stale draft/error).
  useEffect(() => {
    if (open) reset(ADD_CURRENCY_DEFAULTS)
  }, [open, reset])

  function close() {
    reset(ADD_CURRENCY_DEFAULTS)
    onOpenChange(false)
  }

  async function onSubmit(values: AddCurrencyForm) {
    if (existingCodes.includes(values.code)) {
      setError("code", {
        type: "duplicate",
        message: `${values.code} is already in the catalog`,
      })
      return
    }
    try {
      await onSave(values)
      close()
    } catch (error) {
      setError("code", {
        type: "server",
        message: toErrorMessage(error) ?? "Could not add the currency",
      })
    }
  }

  return {
    register,
    errors,
    isSubmitting,
    close,
    submit: handleSubmit(onSubmit),
  }
}
