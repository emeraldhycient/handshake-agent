"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AddBankAccountRequestSchema,
  type AddBankAccountRequest,
  type Beneficiary,
  NIGERIAN_BANKS,
  bankNameForCode,
} from "@handshake-agent/contracts/beneficiaries"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Button } from "@/components/ui/button"
import { useAddBankAccount } from "@/lib/query/beneficiaries"
import { BeneficiaryField } from "./beneficiary-field"
import type { BeneficiaryFormProps } from "@/types/chat"

/**
 * Add a bank account. On a successful add the server returns the name-enquiry
 * result and we require an explicit "Yes, that's correct" before resolving — a
 * typo'd account paying a stranger is the most expensive beneficiary mistake.
 */
export function AddBankForm({ onResolve }: BeneficiaryFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddBankAccountRequest>({
    resolver: zodResolver(AddBankAccountRequestSchema),
  })
  const add = useAddBankAccount()
  const [added, setAdded] = useState<Beneficiary | null>(null)

  async function onSubmit(values: AddBankAccountRequest) {
    try {
      setAdded(await add.mutateAsync(values))
    } catch {
      // Surfaced via add.error below — never silently dropped.
    }
  }

  if (added) {
    return (
      <div
        className="flex flex-col gap-2.5"
        role="group"
        aria-label="Confirm account name"
      >
        <p className="text-[12px] font-medium text-muted-foreground">
          We found this account — is this you?
        </p>
        <div className="rounded-[12px] border border-border bg-background px-3 py-2.5">
          <p
            className="text-[14px] font-semibold text-foreground"
            translate="no"
          >
            {added.accountHolderName ?? added.label}
          </p>
          <p
            className="pt-0.5 text-[12px] text-muted-foreground"
            translate="no"
          >
            {added.accountNumber ?? ""}
            {added.bankCode
              ? ` · ${bankNameForCode(added.bankCode) ?? added.bankCode}`
              : ""}
          </p>
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          Money sent to the wrong account can&apos;t be recovered — confirm the
          name matches before continuing.
        </p>
        <Button
          type="button"
          onClick={() => onResolve(added.id)}
          className="mt-1"
        >
          Yes, that&apos;s correct
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setAdded(null)}
          className="mt-0.5"
        >
          No, re-enter details
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2.5">
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
      <BeneficiaryField label="Bank" error={errors.bankCode?.message}>
        {/* Users don't know bank codes — pick by name, submit the code. */}
        <NativeSelect
          aria-label="Bank"
          defaultValue=""
          {...register("bankCode")}
        >
          <option value="" disabled>
            Select your bank
          </option>
          {NIGERIAN_BANKS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      </BeneficiaryField>
      <BeneficiaryField label="Label" error={errors.label?.message}>
        <Input placeholder="My GTB" aria-label="Label" {...register("label")} />
      </BeneficiaryField>
      {add.isError && (
        <p className="text-[12.5px] text-warn" role="alert">
          We couldn&apos;t verify that account. Check the number and bank code,
          then try again.
        </p>
      )}
      <Button type="submit" disabled={add.isPending} className="mt-1">
        {add.isPending ? "Verifying…" : "Add bank account"}
      </Button>
    </form>
  )
}
