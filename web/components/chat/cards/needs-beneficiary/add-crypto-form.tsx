"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AddCryptoAddressRequestSchema,
  type AddCryptoAddressRequest,
} from "@handshake-agent/contracts/beneficiaries"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useAddCryptoAddress } from "@/lib/query/beneficiaries"
import { BeneficiaryField } from "./beneficiary-field"
import type { BeneficiaryFormProps } from "@/types/chat"

/** Add a crypto (USDT/TRON) address; resolves immediately on a successful add. */
export function AddCryptoForm({ onResolve }: BeneficiaryFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddCryptoAddressRequest>({
    resolver: zodResolver(AddCryptoAddressRequestSchema),
    // TRON / USDT are the only supported network/asset at launch.
    defaultValues: { network: "TRON", asset: "USDT" },
  })
  const add = useAddCryptoAddress()

  async function onSubmit(values: AddCryptoAddressRequest) {
    try {
      const created = await add.mutateAsync(values)
      onResolve(created.id)
    } catch {
      // Surfaced via add.error below.
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2.5">
      <BeneficiaryField
        label="USDT address (TRON)"
        error={errors.address?.message}
      >
        <Input
          placeholder="T…"
          aria-label="USDT address (TRON)"
          {...register("address")}
        />
      </BeneficiaryField>
      <BeneficiaryField label="Label" error={errors.label?.message}>
        <Input
          placeholder="My wallet"
          aria-label="Label"
          {...register("label")}
        />
      </BeneficiaryField>
      {add.isError && (
        <p className="text-[12.5px] text-warn" role="alert">
          That address looks invalid for the TRON network. Please check it and
          try again.
        </p>
      )}
      <Button type="submit" disabled={add.isPending} className="mt-1">
        {add.isPending ? "Saving…" : "Add address"}
      </Button>
    </form>
  )
}
