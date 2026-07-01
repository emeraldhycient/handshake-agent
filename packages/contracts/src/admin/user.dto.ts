import { z } from "zod";

// Admin user-management DTOs — the admin-user list row, cursor-paginated list
// response, role-change and status-change requests, and the one-time bootstrap
// handshake that mints the very first admin invitation.

export const AdminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  status: z.enum(["pending", "active", "suspended", "offboarded"]),
  mfaEnabled: z.boolean(),
  role: z.object({ id: z.string().uuid(), name: z.string() }),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserListResponseSchema = z.object({
  items: z.array(AdminUserSchema),
  nextCursor: z.string().nullable(),
});
export type AdminUserListResponse = z.infer<
  typeof AdminUserListResponseSchema
>;

export const AdminUserUpdateRoleRequestSchema = z.object({
  roleId: z.string().uuid(),
});
export type AdminUserUpdateRoleRequest = z.infer<
  typeof AdminUserUpdateRoleRequestSchema
>;

// Settable statuses only — `pending` is set by invitation, never by this endpoint.
export const AdminUserStatusRequestSchema = z.object({
  status: z.enum(["active", "suspended", "offboarded"]),
});
export type AdminUserStatusRequest = z.infer<
  typeof AdminUserStatusRequestSchema
>;

export const AdminBootstrapRequestSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
});
export type AdminBootstrapRequest = z.infer<typeof AdminBootstrapRequestSchema>;

export const AdminBootstrapResponseSchema = z.object({
  invitationId: z.string().uuid(),
  invitationToken: z.string(),
  expiresAt: z.string(),
});
export type AdminBootstrapResponse = z.infer<
  typeof AdminBootstrapResponseSchema
>;
