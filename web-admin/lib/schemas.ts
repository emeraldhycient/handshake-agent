/**
 * Local Zod schemas — web-only shapes (forms with UX-only fields). Anything that
 * crosses the FE/BE boundary lives in `@handshake-agent/contracts`, not here.
 */

import { z } from "zod"

// ─── Accept-invite form (web-only; password confirmation is a UX concern) ────────
// The wire request is `AdminInvitationAcceptRequestSchema`; this adds a confirm
// field and a min-length message tuned for the form, validated client-side only.

export const AcceptInviteFormSchema = z
  .object({
    password: z.string().min(12, "Password must be at least 12 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
export type AcceptInviteForm = z.infer<typeof AcceptInviteFormSchema>
