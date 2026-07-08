"use client"

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
import { NativeSelect } from "@/components/ui/native-select"
import { FormField } from "@/components/shared/form-field"
import { useUpdateProfile } from "@/lib/query/profile"
import {
  EditProfileFormSchema,
  toUpdateProfileRequest,
  type EditProfileFormValues,
} from "@/lib/schemas/settings"
import { toErrorMessage } from "@/lib/error-message"
import type { EditProfileDialogProps } from "@/types"

/**
 * Edit the two self-service profile fields: contact phone + display currency.
 * KYC-owned identity (name, DOB, ID numbers) is immutable here by design
 * (§3.4) — the PATCH body is a strict contracts schema that rejects them.
 */
export function EditProfileDialog({
  open,
  onOpenChange,
  profile,
  fiats,
}: EditProfileDialogProps) {
  const update = useUpdateProfile()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditProfileFormValues>({
    resolver: zodResolver(EditProfileFormSchema),
    values: { phone: profile.phone ?? "", fiatCurrency: profile.fiatCurrency },
  })

  // The /config list drives the options; the server re-validates against the
  // live catalog (§3.3). Keep the current value selectable even if /config is
  // still loading so the form never silently switches currency.
  const currencyOptions = fiats.some((f) => f.code === profile.fiatCurrency)
    ? fiats
    : [
        {
          code: profile.fiatCurrency,
          displayName: profile.fiatCurrency,
          symbol: "",
          decimals: 2,
        },
        ...fiats,
      ]

  async function onSubmit(values: EditProfileFormValues) {
    const body = toUpdateProfileRequest(values, profile)
    if (!body) {
      onOpenChange(false)
      return
    }
    try {
      await update.mutateAsync(body)
      onOpenChange(false)
    } catch {
      // Surfaced via update.error below — never silently dropped.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Update your contact phone and display currency. Identity details
            are verified through KYC and can&apos;t be changed here.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormField
            id="profile-phone"
            label="Phone number"
            type="tel"
            inputMode="tel"
            placeholder="+2348012345678"
            error={errors.phone?.message}
            {...register("phone")}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="profile-fiat"
              className="text-sm font-medium text-foreground"
            >
              Display currency
            </label>
            <NativeSelect id="profile-fiat" {...register("fiatCurrency")}>
              {currencyOptions.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.code}
                  {f.displayName && f.displayName !== f.code
                    ? ` — ${f.displayName}`
                    : ""}
                </option>
              ))}
            </NativeSelect>
            {errors.fiatCurrency?.message && (
              <p role="alert" className="text-xs text-destructive">
                {errors.fiatCurrency.message}
              </p>
            )}
          </div>
          {update.isError && (
            <p className="text-[12.5px] text-danger" role="alert">
              {toErrorMessage(update.error)}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={update.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
