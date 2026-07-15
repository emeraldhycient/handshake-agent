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
import { FormField } from "@/components/shared/form-field"
import { useMe } from "@/lib/query/auth"
import { useUpdateProfile } from "@/lib/query/profile"
import { useSetName } from "@/lib/query/kyc-onboarding"
import {
  EditProfileFormSchema,
  toUpdateProfileRequest,
  type EditProfileFormValues,
} from "@/lib/schemas/settings"
import { toErrorMessage } from "@/lib/error-message"
import type { EditProfileDialogProps } from "@/types"

/** Tiers at which the KYC name is locked (server 409s on a name change). */
const NAME_LOCKED_TIERS = ["tier_2", "tier_3"]

/**
 * Edit the self-service profile fields: the KYC name (only before verification —
 * it locks at tier_2+) and the contact phone. Name goes through the dedicated
 * POST /profile/name endpoint; phone through the strict PATCH /profile body.
 * Display currency lives in Preferences. Email is never editable here.
 */
export function EditProfileDialog({
  open,
  onOpenChange,
  profile,
}: EditProfileDialogProps) {
  const me = useMe()
  const update = useUpdateProfile()
  const setName = useSetName()

  const nameEditable = !NAME_LOCKED_TIERS.includes(profile.kycTier)
  const firstName0 = me.data?.firstName ?? ""
  const lastName0 = me.data?.lastName ?? ""

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditProfileFormValues>({
    resolver: zodResolver(EditProfileFormSchema),
    values: {
      firstName: firstName0,
      lastName: lastName0,
      phone: profile.phone ?? "",
    },
  })

  async function onSubmit(values: EditProfileFormValues) {
    try {
      if (nameEditable) {
        const firstName = values.firstName.trim()
        const lastName = values.lastName.trim()
        if (
          firstName &&
          lastName &&
          (firstName !== firstName0 || lastName !== lastName0)
        ) {
          await setName.mutateAsync({ firstName, lastName })
        }
      }
      const body = toUpdateProfileRequest(values, profile)
      if (body) await update.mutateAsync(body)
      onOpenChange(false)
    } catch {
      // Surfaced via the error line below — never silently dropped.
    }
  }

  const errorMessage = update.isError
    ? toErrorMessage(update.error)
    : setName.isError
      ? toErrorMessage(setName.error)
      : null
  const pending = update.isPending || setName.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            {nameEditable
              ? "Update your name and contact phone. Your name locks once your identity is verified."
              : "Update your contact phone. Your name is locked after identity verification and can't be changed here."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="grid grid-cols-2 gap-3">
            <FormField
              id="profile-first-name"
              label="First name"
              placeholder="First name"
              autoComplete="given-name"
              disabled={!nameEditable}
              error={errors.firstName?.message}
              {...register("firstName")}
            />
            <FormField
              id="profile-last-name"
              label="Last name"
              placeholder="Last name"
              autoComplete="family-name"
              disabled={!nameEditable}
              error={errors.lastName?.message}
              {...register("lastName")}
            />
          </div>
          <FormField
            id="profile-phone"
            label="Phone number"
            type="tel"
            inputMode="tel"
            placeholder="+2348012345678"
            error={errors.phone?.message}
            {...register("phone")}
          />
          {errorMessage && (
            <p className="text-[12.5px] text-danger" role="alert">
              {errorMessage}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
