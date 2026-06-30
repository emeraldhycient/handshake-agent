import { z } from "zod";

// Admin invitation DTOs — an existing admin invites a new one (email + roleId),
// the server returns a one-time `invitationToken` to the caller (never stored in
// plaintext), and the invitee accepts by setting a password (≥12 chars).

export const AdminInvitationCreateRequestSchema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid(),
  reason: z.string().optional(),
});
export type AdminInvitationCreateRequest = z.infer<
  typeof AdminInvitationCreateRequestSchema
>;

export const AdminInvitationCreateResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  expiresAt: z.string(),
  // Returned once to the caller; never persisted in plaintext.
  invitationToken: z.string(),
});
export type AdminInvitationCreateResponse = z.infer<
  typeof AdminInvitationCreateResponseSchema
>;

export const AdminInvitationAcceptRequestSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12),
});
export type AdminInvitationAcceptRequest = z.infer<
  typeof AdminInvitationAcceptRequestSchema
>;

export const AdminInvitationAcceptResponseSchema = z.object({
  adminId: z.string().uuid(),
});
export type AdminInvitationAcceptResponse = z.infer<
  typeof AdminInvitationAcceptResponseSchema
>;
