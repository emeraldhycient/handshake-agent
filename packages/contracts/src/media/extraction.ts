import { z } from 'zod'

/**
 * Structured candidate extracted from an incoming image/document.
 *
 * SACROSANCT (§3.1): this is a *candidate* the vision model proposes — never a
 * value that moves money. The application layer validates it (address pattern /
 * bank name-enquiry) before persisting a beneficiary, and any send/sell still
 * requires the full proposal → confirmation → PIN path.
 */
export const DocumentExtractionResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('crypto_address'),
    address: z.string().min(1),
    /** Network id (e.g. 'tron'); optional — inferred server-side when absent. */
    network: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('bank_account'),
    accountNumber: z.string().min(1),
    bankName: z.string().min(1).optional(),
    bankCode: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal('none') }),
])

export type DocumentExtractionResult = z.infer<typeof DocumentExtractionResultSchema>
