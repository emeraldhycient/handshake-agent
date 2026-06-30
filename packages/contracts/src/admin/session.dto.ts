import { z } from "zod";

// Admin session metadata for the sessions list. Metadata only — the token hash
// is NEVER surfaced. Single source of truth shared by the API and web-admin.
export const AdminSessionViewSchema = z.object({
  id: z.string().uuid(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  stepUpCompletedAt: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type AdminSessionView = z.infer<typeof AdminSessionViewSchema>;

export const AdminSessionListResponseSchema = z.object({
  items: z.array(AdminSessionViewSchema),
});
export type AdminSessionListResponse = z.infer<
  typeof AdminSessionListResponseSchema
>;
