import { z } from "zod";

import { FiatCurrencySchema } from "../common";

/**
 * Admin "Add currency" (runtime CustomFiat). Adding a currency creates it DISABLED —
 * it becomes live only after pricing is configured and it is explicitly enabled
 * (the fail-closed enabled-needs-pricing invariant, re-checked server-side). None of
 * these actions move money; each is step-up-gated + audited on the server.
 */

/** Create a runtime custom currency. `code` reuses the shared 3-letter format check. */
export const AdminCustomFiatCreateRequestSchema = z.object({
  code: FiatCurrencySchema,
  displayName: z.string().min(1).max(60),
  symbol: z.string().min(1).max(8),
  decimals: z.number().int().min(0).max(8),
});
export type AdminCustomFiatCreateRequest = z.infer<
  typeof AdminCustomFiatCreateRequestSchema
>;

/**
 * Update a runtime custom currency — enable/disable and/or edit its display metadata.
 * Enabling is fail-closed: the server rejects it unless the currency has pricing.
 */
export const AdminCustomFiatUpdateRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    displayName: z.string().min(1).max(60).optional(),
    symbol: z.string().min(1).max(8).optional(),
    decimals: z.number().int().min(0).max(8).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field must be provided",
  });
export type AdminCustomFiatUpdateRequest = z.infer<
  typeof AdminCustomFiatUpdateRequestSchema
>;

/** A runtime custom currency as returned by the currency admin endpoints. */
export const AdminCustomFiatSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
});
export type AdminCustomFiat = z.infer<typeof AdminCustomFiatSchema>;

export const AdminCustomFiatListResponseSchema = z.object({
  items: z.array(AdminCustomFiatSchema),
});
export type AdminCustomFiatListResponse = z.infer<
  typeof AdminCustomFiatListResponseSchema
>;
