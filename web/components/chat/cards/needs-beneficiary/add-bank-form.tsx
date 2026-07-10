"use client"

import { useConfig } from "@/lib/query/hooks"
import { useProfile } from "@/lib/query/auth"
import {
  buildBankFiatOptions,
  pickDefaultCurrency,
} from "@/lib/beneficiaries/fiat-options"
import { AddBankFormFields } from "./add-bank-form-fields"
import type { BeneficiaryFormProps } from "@/types/chat"

/**
 * Add a bank account (orchestrator). Resolves the currency/country options from
 * the enabled fiats in `/config` and defaults to the user's profile currency,
 * then mounts the fields. Keyed by the default currency so RHF re-inits its
 * default once the profile resolves (no `useEffect` on server state).
 */
export function AddBankForm({ onResolve }: BeneficiaryFormProps) {
  const config = useConfig()
  const profile = useProfile()

  const options = buildBankFiatOptions(config.data?.fiats)
  const defaultCurrency = pickDefaultCurrency(
    options,
    profile.data?.fiatCurrency
  )

  return (
    <AddBankFormFields
      key={defaultCurrency}
      options={options}
      defaultCurrency={defaultCurrency}
      onResolve={onResolve}
    />
  )
}
