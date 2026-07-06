"use client"

import { useFormContext } from "react-hook-form"
import { FormField } from "@/components/shared/form-field"
import type { KycFieldValues, KycFieldsProps } from "@/types/kyc"

/**
 * The identity + PIN fields shared by both KYC forms. Reads register/errors from
 * react-hook-form context (both forms wrap it in a FormProvider), so it stays
 * decoupled from each form's exact value type (root §16, §13.2).
 */
export function KycFields({
  idPrefix: p,
  showConfirmPin,
  dateOfBirthType = "text",
  loading,
}: KycFieldsProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<KycFieldValues>()

  const dobProps =
    dateOfBirthType === "date"
      ? { type: "date" as const }
      : {
          type: "text" as const,
          inputMode: "numeric" as const,
          placeholder: "YYYY-MM-DD",
        }

  return (
    <>
      <FormField
        id={`${p}-firstName`}
        label="First name"
        type="text"
        autoComplete="given-name"
        aria-required="true"
        placeholder="e.g. Amara"
        disabled={loading}
        error={errors.firstName?.message}
        {...register("firstName")}
      />

      <FormField
        id={`${p}-lastName`}
        label="Last name"
        type="text"
        autoComplete="family-name"
        aria-required="true"
        placeholder="e.g. Okafor"
        disabled={loading}
        error={errors.lastName?.message}
        {...register("lastName")}
      />

      <FormField
        id={`${p}-dateOfBirth`}
        label={
          <>
            Date of birth{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </>
        }
        autoComplete="bday"
        disabled={loading}
        error={errors.dateOfBirth?.message}
        {...dobProps}
        {...register("dateOfBirth")}
      />

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="text-sm font-medium text-foreground">
          NIN or BVN{" "}
          <span className="font-normal text-muted-foreground">
            (at least one required)
          </span>
        </legend>
        <p className="text-xs text-muted-foreground">
          Enter your 11-digit National Identification Number (NIN) or Bank
          Verification Number (BVN). You only need to provide one.
        </p>

        <FormField
          id={`${p}-nin`}
          label="NIN (National Identification Number)"
          type="text"
          inputMode="numeric"
          pattern="\d{11}"
          maxLength={11}
          placeholder="11-digit NIN"
          disabled={loading}
          error={errors.nin?.message}
          {...register("nin")}
        />

        <FormField
          id={`${p}-bvn`}
          label="BVN (Bank Verification Number)"
          type="text"
          inputMode="numeric"
          pattern="\d{11}"
          maxLength={11}
          placeholder="11-digit BVN"
          disabled={loading}
          error={errors.bvn?.message}
          {...register("bvn")}
        />
      </fieldset>

      <FormField
        id={`${p}-pin`}
        label="Transaction PIN"
        type="password"
        inputMode="numeric"
        pattern="\d{4,6}"
        autoComplete="new-password"
        aria-required="true"
        placeholder="Set a 4–6 digit PIN"
        minLength={4}
        maxLength={6}
        disabled={loading}
        error={errors.pin?.message}
        hint="4–6 digits. Avoid repeated digits (1111) or sequences (1234)."
        {...register("pin")}
      />

      {showConfirmPin && (
        <FormField
          id={`${p}-confirmPin`}
          label="Confirm PIN"
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          autoComplete="new-password"
          aria-required="true"
          placeholder="Re-enter your PIN"
          minLength={4}
          maxLength={6}
          disabled={loading}
          error={errors.confirmPin?.message}
          {...register("confirmPin")}
        />
      )}
    </>
  )
}
