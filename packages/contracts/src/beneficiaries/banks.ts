/**
 * Bank-list contract + the canonical Nigerian offline fallback.
 *
 * The `GET /beneficiaries/banks?country=` endpoint is backed by Flutterwave's
 * real `GET /banks/{country}` API (per-country, cached server-side).
 * `NIGERIAN_BANKS` remains ONLY as an offline fallback so the web bank-account
 * dropdown and the WhatsApp Flow bank picker still render when the endpoint is
 * unreachable. Codes line up with what the Flutterwave name-enquiry / payout
 * APIs expect (account_bank = code).
 *
 * Users do not know bank codes — surfaces should show `name` and submit `code`.
 */

import { z } from 'zod'

/** A single bank option: display `name` + submittable `code`. */
export const BankSchema = z.object({
  name: z.string(),
  code: z.string(),
})
export type Bank = z.infer<typeof BankSchema>

/** Response of `GET /beneficiaries/banks?country=<ISO alpha-2>`. */
export const BankListResponseSchema = z.object({
  banks: z.array(BankSchema),
})
export type BankListResponse = z.infer<typeof BankListResponseSchema>

/** Query for `GET /beneficiaries/banks` — ISO 3166-1 alpha-2 country code. */
export const BankListQuerySchema = z.object({
  country: z.string().trim().length(2),
})
export type BankListQuery = z.infer<typeof BankListQuerySchema>

/** Major Nigerian banks + fintechs, sorted by name. Codes are NIBSS/Flutterwave. */
export const NIGERIAN_BANKS: readonly Bank[] = [
  { name: 'Access Bank', code: '044' },
  { name: 'Citibank Nigeria', code: '023' },
  { name: 'Ecobank Nigeria', code: '050' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'First City Monument Bank (FCMB)', code: '214' },
  { name: 'Globus Bank', code: '00103' },
  { name: 'Guaranty Trust Bank (GTBank)', code: '058' },
  { name: 'Heritage Bank', code: '030' },
  { name: 'Jaiz Bank', code: '301' },
  { name: 'Keystone Bank', code: '082' },
  { name: 'Kuda Microfinance Bank', code: '50211' },
  { name: 'Moniepoint MFB', code: '50515' },
  { name: 'OPay', code: '999992' },
  { name: 'PalmPay', code: '999991' },
  { name: 'Parallex Bank', code: '104' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'Providus Bank', code: '101' },
  { name: 'Stanbic IBTC Bank', code: '221' },
  { name: 'Standard Chartered Bank', code: '068' },
  { name: 'Sterling Bank', code: '232' },
  { name: 'SunTrust Bank', code: '100' },
  { name: 'Union Bank of Nigeria', code: '032' },
  { name: 'United Bank for Africa (UBA)', code: '033' },
  { name: 'Unity Bank', code: '215' },
  { name: 'Wema Bank', code: '035' },
  { name: 'Zenith Bank', code: '057' },
] as const;

/** Lookup a bank name by its code (for display of saved beneficiaries). */
export function bankNameForCode(code: string): string | undefined {
  return NIGERIAN_BANKS.find((b) => b.code === code)?.name;
}
