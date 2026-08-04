"use client"

import { useEffect, useMemo } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import {
  ADD_PRICE_DEFAULTS,
  AddPriceFormSchema,
  type AddPriceForm,
} from "@/lib/pricing/add-price-schema"
import type { AddPriceDialogProps } from "@/types"

/**
 * View-model for the "Add a price" dialog. Owns the RHF form (asset / currency /
 * rate), resets it on each open, and derives the choosable assets + the currency
 * list narrowed to the chosen asset (so a rate is only offered for a pair that
 * lacks one). On submit it hands the captured triple up via `onContinue` — this
 * dialog only captures the value; the parent runs the reason → step-up →
 * maker-checker chain that actually PATCHes the rate (§3.1, root §7).
 */
export function useAddPriceForm({
  open,
  options,
  onOpenChange,
  onContinue,
}: AddPriceDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AddPriceForm>({
    resolver: zodResolver(AddPriceFormSchema),
    defaultValues: ADD_PRICE_DEFAULTS,
  })

  useEffect(() => {
    if (open) reset(ADD_PRICE_DEFAULTS)
  }, [open, reset])

  const assets = useMemo(
    () => [...new Set(options.map((o) => o.asset))],
    [options]
  )
  // `useWatch` (not `watch()`) so the derived currency list memoizes cleanly.
  const chosenAsset = useWatch({ control, name: "asset" })
  const codes = useMemo(
    () => options.filter((o) => o.asset === chosenAsset).map((o) => o.code),
    [options, chosenAsset]
  )

  function close() {
    reset(ADD_PRICE_DEFAULTS)
    onOpenChange(false)
  }

  const onFormSubmit = handleSubmit((values) => {
    onContinue({ asset: values.asset, code: values.code, rate: values.rate })
    close()
  })

  return {
    register,
    setValue,
    errors,
    isSubmitting,
    assets,
    codes,
    chosenAsset,
    close,
    onFormSubmit,
    /** Radix onOpenChange: opening is passed through, closing routes via `close` (resets). */
    onDialogOpenChange: (next: boolean) => (next ? onOpenChange(true) : close()),
  }
}
