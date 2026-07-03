"use client"

/**
 * AddCurrencyDialog — register a runtime custom fiat currency (root CLAUDE.md §7:
 * adding a currency is an admin-gated *config* change, not a code change). Fields
 * map onto the boundary DTO `AdminCustomFiatCreateRequest` (code / displayName /
 * symbol / decimals); the client re-parses that DTO before the request fires (§8)
 * and the server re-validates it (§3.3 — the FE gate is UX, never the only check).
 *
 * The currency is always created DISABLED: the "enabled needs pricing" invariant is
 * fail-closed server-side, so enabling happens later from the Live toggle once base
 * rates exist. Nothing here moves money (§3.1). The write is step-up-gated + audited
 * by the parent (it may trigger a re-auth challenge the parent resolves), so on
 * submit this dialog awaits `onSave`, surfaces any error inline, and closes on
 * success. Focus-trapped, Esc-closable via the Dialog primitive.
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
import { FiatCurrencySchema } from "@handshake-agent/contracts"
import type { AddCurrencyDialogProps } from "@/types/components"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

// Form schema — the boundary DTO's fields with input ergonomics on top: the code is
// upper-cased before it is checked against `FiatCurrencySchema` (a 3-letter ISO-ish
// code), and decimals is coerced from the numeric input. The parsed output is exactly
// `AdminCustomFiatCreateRequest`, which the API client re-parses defensively.
const AddCurrencyFormSchema = z.object({
  code: z.string().trim().toUpperCase().pipe(FiatCurrencySchema),
  displayName: z.string().trim().min(1, "Enter a display name").max(60),
  symbol: z.string().trim().min(1, "Enter a symbol").max(8),
  decimals: z.coerce
    .number({ invalid_type_error: "Enter a whole number" })
    .int("Enter a whole number")
    .min(0, "0–8 decimal places")
    .max(8, "0–8 decimal places"),
})
type AddCurrencyForm = z.infer<typeof AddCurrencyFormSchema>

const DEFAULTS: AddCurrencyForm = {
  code: "",
  displayName: "",
  symbol: "",
  decimals: 2,
}

export function AddCurrencyDialog({
  open,
  onOpenChange,
  existingCodes,
  onSave,
}: AddCurrencyDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AddCurrencyForm>({
    resolver: zodResolver(AddCurrencyFormSchema),
    defaultValues: DEFAULTS,
  })

  // Re-seed the form whenever the dialog opens (drop any stale draft/error).
  useEffect(() => {
    if (open) reset(DEFAULTS)
  }, [open, reset])

  function close() {
    reset(DEFAULTS)
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
        message: errorMessage(error) ?? "Could not add the currency",
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
          <DialogTitle>Add a currency</DialogTitle>
          <DialogDescription>
            Register a new fiat currency. It is created disabled — enable it from
            the Live toggle once base rates are configured.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currency-code">Code</Label>
              <Input
                id="currency-code"
                aria-invalid={!!errors.code}
                placeholder="e.g. GHS"
                maxLength={3}
                autoCapitalize="characters"
                disabled={isSubmitting}
                className="font-mono text-[12.5px] uppercase"
                {...register("code")}
              />
              {errors.code && (
                <p role="alert" className="text-[11.5px] font-semibold text-tdn">
                  {errors.code.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currency-symbol">Symbol</Label>
              <Input
                id="currency-symbol"
                aria-invalid={!!errors.symbol}
                placeholder="e.g. ₵"
                disabled={isSubmitting}
                {...register("symbol")}
              />
              {errors.symbol && (
                <p role="alert" className="text-[11.5px] font-semibold text-tdn">
                  {errors.symbol.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currency-name">Display name</Label>
            <Input
              id="currency-name"
              aria-invalid={!!errors.displayName}
              placeholder="e.g. Ghanaian Cedi"
              disabled={isSubmitting}
              {...register("displayName")}
            />
            {errors.displayName && (
              <p role="alert" className="text-[11.5px] font-semibold text-tdn">
                {errors.displayName.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currency-decimals">Rounding (decimal places)</Label>
            <Input
              id="currency-decimals"
              type="number"
              inputMode="numeric"
              min={0}
              max={8}
              aria-invalid={!!errors.decimals}
              disabled={isSubmitting}
              className="font-mono text-[12.5px] tabular-nums"
              {...register("decimals")}
            />
            {errors.decimals && (
              <p role="alert" className="text-[11.5px] font-semibold text-tdn">
                {errors.decimals.message}
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
              {isSubmitting ? "Adding…" : "Add currency"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
