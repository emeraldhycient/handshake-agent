import { z } from 'zod'
import { SupportedAssetSchema, NetworkSchema } from '../common'

/**
 * Saved payout-destination contracts (sell → bank account, send → crypto
 * address). One schema, three consumers (FE forms + axios, api DTOs, agent).
 *
 * Server-side validation is the security gate (§3.3): the name-enquiry lookup
 * (bank) and address-pattern + cooling-off (crypto) run in BeneficiaryService —
 * these schemas are the shape/UX gate only.
 */

// ─── Type ───────────────────────────────────────────────────────────────────

export const BeneficiaryTypeSchema = z.enum(['bank_account', 'crypto_address'])
export type BeneficiaryType = z.infer<typeof BeneficiaryTypeSchema>

// ─── List query ───────────────────────────────────────────────────────────

export const ListBeneficiariesQuerySchema = z.object({
  type: BeneficiaryTypeSchema,
})
export type ListBeneficiariesQuery = z.infer<
  typeof ListBeneficiariesQuerySchema
>

// ─── Beneficiary (response item) ────────────────────────────────────────────

/**
 * A saved beneficiary as returned to the client. Bank-account fields are null
 * on crypto rows and vice-versa. Timestamps are ISO strings (the server maps
 * the persisted Date → ISO before responding).
 */
export const BeneficiarySchema = z.object({
  id: z.string().uuid(),
  type: BeneficiaryTypeSchema,
  label: z.string(),
  // Bank-account fields
  accountNumber: z.string().nullable(),
  accountHolderName: z.string().nullable(),
  bankCode: z.string().nullable(),
  // Crypto-address fields
  cryptoAddress: z.string().nullable(),
  cryptoAsset: z.string().nullable(),
  cryptoNetwork: z.string().nullable(),
  verificationStatus: z.string(),
  isDefault: z.boolean(),
  /** First-use cooling-off expiry (IDN-08) — ISO string, or null once elapsed/N/A. */
  firstUseLockedUntil: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type Beneficiary = z.infer<typeof BeneficiarySchema>

export const BeneficiaryListResponseSchema = z.object({
  beneficiaries: z.array(BeneficiarySchema),
})
export type BeneficiaryListResponse = z.infer<
  typeof BeneficiaryListResponseSchema
>

// ─── Delete beneficiary ─────────────────────────────────────────────────────

/**
 * Acknowledgement returned by DELETE /beneficiaries/:id. The removal is a
 * soft-delete (sets `deletedAt`) so funds-safety history is preserved; the row
 * is excluded from every subsequent list/lookup. `deleted` is a literal `true`
 * — the endpoint either acks a deletion or throws (404 when not found).
 */
export const DeleteBeneficiaryResponseSchema = z.object({
  id: z.string().uuid(),
  deleted: z.literal(true),
})
export type DeleteBeneficiaryResponse = z.infer<
  typeof DeleteBeneficiaryResponseSchema
>

// ─── Add bank account ───────────────────────────────────────────────────────

export const AddBankAccountRequestSchema = z.object({
  /** 10-digit NUBAN. */
  accountNumber: z.string().regex(/^\d{10}$/, 'Enter a valid 10-digit account number'),
  /** Bank / clearing code (e.g. "058" for GTB). */
  bankCode: z.string().min(3).max(10),
  label: z.string().min(1).max(60),
})
export type AddBankAccountRequest = z.infer<typeof AddBankAccountRequestSchema>

// ─── Add crypto address ─────────────────────────────────────────────────────

export const AddCryptoAddressRequestSchema = z.object({
  /** On-chain address — pattern-validated server-side against the network. */
  address: z.string().min(1).max(120),
  network: NetworkSchema,
  asset: SupportedAssetSchema,
  label: z.string().min(1).max(60),
})
export type AddCryptoAddressRequest = z.infer<
  typeof AddCryptoAddressRequestSchema
>
