/**
 * Local Zod schemas — shapes used by the admin app that are NOT (yet) defined in
 * `@handshake-agent/contracts`. Anything that crosses the FE/BE boundary and is
 * shared should live in contracts; this file holds admin-only response shapes
 * the API exposes inline (the session view) plus the accept-invite form schema.
 */

import { z } from "zod"

// ─── Admin session view (GET /admin/sessions) ────────────────────────────────────
// Mirrors the controller's `AdminSessionView` — metadata only, never the token
// hash. Not in contracts today; define it here and parse the response with it.

export const AdminSessionViewSchema = z.object({
  id: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  stepUpCompletedAt: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
})
export type AdminSessionView = z.infer<typeof AdminSessionViewSchema>

export const AdminSessionListResponseSchema = z.object({
  items: z.array(AdminSessionViewSchema),
})
export type AdminSessionListResponse = z.infer<
  typeof AdminSessionListResponseSchema
>

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
