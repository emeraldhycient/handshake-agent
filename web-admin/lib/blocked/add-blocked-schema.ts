import { z } from "zod"

/**
 * Local UI-only form schema for the "Add to the blocked list" dialog — there is no
 * cross-boundary DTO for a single denylist entry (the whole `string[]` is what the
 * setting's schema validates server-side, §3.3). `value` is the address/identifier
 * to block; `reason` is captured for the immutable audit note only (design §6.7).
 */
export const AddBlockedFormSchema = z.object({
  value: z.string().trim().min(1, "Enter an address or identifier"),
  reason: z.string().trim().max(280).optional(),
})

export type AddBlockedForm = z.infer<typeof AddBlockedFormSchema>

/** Empty defaults — re-seeded whenever the dialog opens (drops any stale draft). */
export const ADD_BLOCKED_DEFAULTS: AddBlockedForm = { value: "", reason: "" }
