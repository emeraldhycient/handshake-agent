"use client"

import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AddBankAccountRequestSchema,
  type AddBankAccountRequest,
  type Beneficiary,
} from "@handshake-agent/contracts/beneficiaries"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Button } from "@/components/ui/button"
import { useAddBankAccount } from "@/lib/query/beneficiaries"
import { getDeviceFingerprint } from "@/lib/device"
import { pinErrorMessage } from "@/lib/settings/pin-error"
import { DEFAULT_BANK_COUNTRY } from "@/constants/beneficiaries"
import { BeneficiaryField } from "./beneficiary-field"
import { BankSelectField } from "./bank-select-field"
import { ConfirmBankName } from "./confirm-bank-name"
import type { AddBankFormFieldsProps } from "@/types/chat"

const PIN_INPUT_PROPS = {
  type: "password",
  inputMode: "numeric",
  autoComplete: "off",
  maxLength: 6,
  placeholder: "••••",
} as const

/**
 * The add-bank fields, mounted once its currency/country options resolve. The
 * country drives which bank list loads; adding a payout destination is step-up
 * gated server-side (§3.3), so the PIN is required and PIN failures map to
 * distinct copy. On success the server's name-enquiry result must be confirmed
 * before we resolve (funds-safety — a typo can't be recovered).
 */
export function AddBankFormFields({
  options,
  defaultCurrency,
  onResolve,
}: AddBankFormFieldsProps) {
  // No explicit field-values generic: the schema's `rail` carries a `.default`,
  // so its input type (rail optional — the form never collects it) diverges from
  // its output type (rail required). Letting the transform-aware zodResolver drive
  // inference types the form fields as the input and `handleSubmit`'s values as the
  // parsed output (AddBankAccountRequest), which is what the mutation consumes.
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(AddBankAccountRequestSchema),
    defaultValues: { currency: defaultCurrency },
  })
  const add = useAddBankAccount()
  const [added, setAdded] = useState<Beneficiary | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  // useWatch (not watch()) — the React-Compiler-safe subscription API.
  const currency = useWatch({ control, name: "currency" }) ?? defaultCurrency
  // Country comes from the resolved option (each carries its /config country),
  // never a hardcoded currency→country map. Falls back to the default only if the
  // selected currency somehow isn't among the offered options.
  const country =
    options.find((o) => o.currency === currency)?.country ??
    options.find((o) => o.currency === defaultCurrency)?.country ??
    DEFAULT_BANK_COUNTRY

  async function onSubmit(values: AddBankAccountRequest) {
    setServerError(null)
    try {
      setAdded(
        await add.mutateAsync({
          ...values,
          // Binds the step-up to this device (§3.4) — same source as the send flow.
          deviceFingerprint: getDeviceFingerprint(),
        })
      )
    } catch (err) {
      // PIN wrong/locked read distinctly; other failures show the server reason.
      setServerError(pinErrorMessage(err))
    }
  }

  if (added) {
    return (
      <ConfirmBankName
        beneficiary={added}
        onConfirm={() => onResolve(added.id)}
        onReenter={() => setAdded(null)}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2.5">
      {options.length > 1 ? (
        <BeneficiaryField
          label="Country / currency"
          error={errors.currency?.message}
        >
          <NativeSelect
            aria-label="Country / currency"
            {...register("currency")}
          >
            {options.map((o) => (
              <option key={o.currency} value={o.currency}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </BeneficiaryField>
      ) : (
        // Single option: keep currency in the payload without a redundant picker.
        <input type="hidden" {...register("currency")} />
      )}
      <BeneficiaryField
        label="Account number"
        error={errors.accountNumber?.message}
      >
        <Input
          inputMode="numeric"
          placeholder="0123456789"
          aria-label="Account number"
          {...register("accountNumber")}
        />
      </BeneficiaryField>
      <BankSelectField
        country={country}
        error={errors.bankCode?.message}
        registration={register("bankCode")}
      />
      <BeneficiaryField label="Label" error={errors.label?.message}>
        <Input placeholder="My GTB" aria-label="Label" {...register("label")} />
      </BeneficiaryField>
      <BeneficiaryField label="Transaction PIN" error={errors.pin?.message}>
        <Input
          aria-label="Transaction PIN"
          {...PIN_INPUT_PROPS}
          {...register("pin")}
        />
      </BeneficiaryField>
      {serverError && (
        <p className="text-[12.5px] text-warn" role="alert">
          {serverError}
        </p>
      )}
      <Button type="submit" disabled={add.isPending} className="mt-1">
        {add.isPending ? "Verifying…" : "Add bank account"}
      </Button>
    </form>
  )
}
