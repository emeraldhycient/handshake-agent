"use client"

import { NIGERIAN_BANKS } from "@handshake-agent/contracts/beneficiaries"
import { NativeSelect } from "@/components/ui/native-select"
import { useBanks } from "@/lib/query/beneficiaries"
import { BeneficiaryField } from "./beneficiary-field"
import type { BankSelectFieldProps } from "@/types/chat"

/**
 * Bank picker for the selected country. Loads the real per-country list from
 * `GET /beneficiaries/banks`; when that errors or comes back empty for Nigeria
 * we fall back to the offline `NIGERIAN_BANKS` list so the happy path never
 * dead-ends. Users pick by name and the form submits the `code`.
 */
export function BankSelectField({
  country,
  error,
  registration,
}: BankSelectFieldProps) {
  const banksQuery = useBanks(country)
  const banks = banksQuery.data?.banks ?? []

  // NG has a trusted offline list; other countries surface the error branch.
  const useNgFallback =
    country === "NG" && (banksQuery.isError || banks.length === 0)
  const options = useNgFallback ? NIGERIAN_BANKS : banks

  if (banksQuery.isPending) {
    return (
      <BeneficiaryField label="Bank" error={error}>
        <NativeSelect aria-label="Bank" disabled defaultValue="">
          <option value="">Loading banks…</option>
        </NativeSelect>
      </BeneficiaryField>
    )
  }

  if (banksQuery.isError && !useNgFallback) {
    return (
      <BeneficiaryField label="Bank" error={error}>
        <NativeSelect aria-label="Bank" disabled defaultValue="">
          <option value="">Couldn&apos;t load banks</option>
        </NativeSelect>
        <span className="text-[11.5px] text-warn" role="alert">
          We couldn&apos;t load banks for this country. Try again shortly.
        </span>
      </BeneficiaryField>
    )
  }

  if (options.length === 0) {
    return (
      <BeneficiaryField label="Bank" error={error}>
        <NativeSelect aria-label="Bank" disabled defaultValue="">
          <option value="">No banks available for this country</option>
        </NativeSelect>
      </BeneficiaryField>
    )
  }

  return (
    <BeneficiaryField label="Bank" error={error}>
      {/* Users don't know bank codes — pick by name, submit the code. */}
      <NativeSelect aria-label="Bank" defaultValue="" {...registration}>
        <option value="" disabled>
          Select your bank
        </option>
        {options.map((b) => (
          <option key={b.code} value={b.code}>
            {b.name}
          </option>
        ))}
      </NativeSelect>
    </BeneficiaryField>
  )
}
