import { z } from "zod"

import { FiatCurrencySchema } from "@handshake-agent/contracts"

/**
 * Add-currency form schema — the boundary DTO's fields with input ergonomics on top: the
 * code is upper-cased before it is checked against `FiatCurrencySchema` (a 3-letter
 * ISO-ish code), and decimals is coerced from the numeric input. The parsed output is
 * exactly `AdminCustomFiatCreateRequest`, which the API client re-parses defensively.
 */
export const AddCurrencyFormSchema = z.object({
  code: z.string().trim().toUpperCase().pipe(FiatCurrencySchema),
  displayName: z.string().trim().min(1, "Enter a display name").max(60),
  symbol: z.string().trim().min(1, "Enter a symbol").max(8),
  decimals: z.coerce
    .number({ invalid_type_error: "Enter a whole number" })
    .int("Enter a whole number")
    .min(0, "0–8 decimal places")
    .max(8, "0–8 decimal places"),
})

export type AddCurrencyForm = z.infer<typeof AddCurrencyFormSchema>

/** The initial form values (a fresh draft each time the dialog opens). */
export const ADD_CURRENCY_DEFAULTS: AddCurrencyForm = {
  code: "",
  displayName: "",
  symbol: "",
  decimals: 2,
}
