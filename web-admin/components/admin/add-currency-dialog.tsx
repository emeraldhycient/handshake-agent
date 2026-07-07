"use client"

/**
 * AddCurrencyDialog — register a runtime custom fiat currency (root CLAUDE.md §7: adding
 * a currency is an admin-gated *config* change). Composition only: `useAddCurrencyForm`
 * owns the RHF form (validated by `AddCurrencyFormSchema`, re-seeded on open) + the
 * duplicate-code guard + the submit→`onSave` chain.
 *
 * The currency is always created DISABLED (the "enabled needs pricing" invariant is
 * fail-closed server-side). Nothing here moves money (§3.1). The write is step-up-gated +
 * audited by the parent; on submit this dialog awaits `onSave`, surfaces any error inline,
 * and closes on success. Focus-trapped, Esc-closable via the Dialog primitive.
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
import { useAddCurrencyForm } from "@/lib/hooks/use-add-currency-form"
import type { AddCurrencyDialogProps } from "@/types/components"

export function AddCurrencyDialog(props: AddCurrencyDialogProps) {
  const { open, onOpenChange } = props
  const f = useAddCurrencyForm(props)
  const { errors, isSubmitting } = f

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : f.close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a currency</DialogTitle>
          <DialogDescription>
            Register a new fiat currency. It is created disabled — enable it
            from the Live toggle once base rates are configured.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={f.submit} noValidate className="flex flex-col gap-4">
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
                {...f.register("code")}
              />
              {errors.code && (
                <p
                  role="alert"
                  className="text-[11.5px] font-semibold text-tdn"
                >
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
                {...f.register("symbol")}
              />
              {errors.symbol && (
                <p
                  role="alert"
                  className="text-[11.5px] font-semibold text-tdn"
                >
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
              {...f.register("displayName")}
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
              {...f.register("decimals")}
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
              onClick={f.close}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Adding…" : "Add currency"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
