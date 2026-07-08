import { z } from "zod"

/**
 * Value-capture schema for the "Add a price" dialog — an (asset, currency, rate)
 * triple for a pair that has no base rate yet. Display-boundary validation only:
 * the authoritative check runs server-side when the parent's reason → step-up →
 * maker-checker chain PATCHes the rate (root CLAUDE.md §7). `rate` is coerced from
 * the number input's string value and must be positive.
 */
export const AddPriceFormSchema = z.object({
  asset: z.string().min(1, "Select an asset"),
  code: z.string().min(1, "Select a currency"),
  rate: z.coerce
    .number({ invalid_type_error: "Enter a rate" })
    .positive("Enter a positive rate"),
})

export type AddPriceForm = z.infer<typeof AddPriceFormSchema>

/** All-empty defaults — every field is invalid until the operator fills it in. */
export const ADD_PRICE_DEFAULTS: AddPriceForm = { asset: "", code: "", rate: 0 }
