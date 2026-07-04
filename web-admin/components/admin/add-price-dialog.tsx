"use client"

/**
 * AddPriceDialog — capture a new base rate for an (asset, currency) pair that has none
 * yet (root CLAUDE.md §7: base rates are admin-tunable config; a currency is fail-closed
 * on enablement until one exists). This is only the VALUE-CAPTURE step — it hands the
 * chosen asset/currency/rate up via `onContinue`, and the parent runs the shared audit
 * chain (reason → step-up → maker-checker) before the PATCH fires. Nothing moves money
 * (§3.1): a base rate is a pricing config leaf, not a transaction.
 *
 * The currency choices are the pairs that lack a rate (so a rate is never double-added);
 * the currency list narrows to the chosen asset. Focus-trapped, Esc-closable.
 */
import { useEffect, useMemo } from "react"
import { useForm, useWatch } from "react-hook-form"
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
import { NativeSelect } from "@/components/ui/native-select"
import type { AddPriceDialogProps } from "@/types/components"

const AddPriceFormSchema = z.object({
  asset: z.string().min(1, "Select an asset"),
  code: z.string().min(1, "Select a currency"),
  rate: z.coerce
    .number({ invalid_type_error: "Enter a rate" })
    .positive("Enter a positive rate"),
})
type AddPriceForm = z.infer<typeof AddPriceFormSchema>

const EMPTY: AddPriceForm = { asset: "", code: "", rate: 0 }

export function AddPriceDialog({
  open,
  onOpenChange,
  options,
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
    defaultValues: EMPTY,
  })

  useEffect(() => {
    if (open) reset(EMPTY)
  }, [open, reset])

  // Distinct assets that still have an unpriced currency, and the currency list for the
  // currently-chosen asset (so a rate is only offered for a pair that lacks one).
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
    reset(EMPTY)
    onOpenChange(false)
  }

  function onSubmit(values: AddPriceForm) {
    onContinue({ asset: values.asset, code: values.code, rate: values.rate })
    close()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a price</DialogTitle>
          <DialogDescription>
            Set a mid-market base rate for an asset in a currency. The change goes
            through reason → step-up → maker-checker before it is applied.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="price-asset">Asset</Label>
              <NativeSelect
                id="price-asset"
                aria-invalid={!!errors.asset}
                disabled={isSubmitting}
                {...register("asset", {
                  onChange: () => setValue("code", ""),
                })}
              >
                <option value="">Select…</option>
                {assets.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </NativeSelect>
              {errors.asset && (
                <p role="alert" className="text-[11.5px] font-semibold text-tdn">
                  {errors.asset.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="price-code">Currency</Label>
              <NativeSelect
                id="price-code"
                aria-invalid={!!errors.code}
                disabled={isSubmitting || !chosenAsset}
                {...register("code")}
              >
                <option value="">Select…</option>
                {codes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
              {errors.code && (
                <p role="alert" className="text-[11.5px] font-semibold text-tdn">
                  {errors.code.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="price-rate">
              Base rate{chosenAsset ? ` (per 1 ${chosenAsset})` : ""}
            </Label>
            <Input
              id="price-rate"
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              aria-invalid={!!errors.rate}
              disabled={isSubmitting}
              className="font-mono text-[12.5px] tabular-nums"
              {...register("rate")}
            />
            {errors.rate && (
              <p role="alert" className="text-[11.5px] font-semibold text-tdn">
                {errors.rate.message}
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
            <Button type="submit" disabled={isSubmitting}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
