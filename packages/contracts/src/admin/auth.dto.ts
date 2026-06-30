import { z } from "zod";

// Admin authentication DTOs — login (password + optional TOTP / recovery code),
// the resolved admin identity (`AdminMe`, including effective RBAC grants), and
// the MFA enroll / confirm / verify + step-up handshakes. Secrets travel only in
// these request bodies; `AdminMe` carries permission ids and resourceIds, never
// raw secrets. The API enforces RBAC server-side regardless of what `AdminMe` lists.

export const AdminLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
  recoveryCode: z.string().optional(),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

export const AdminRoleRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type AdminRoleRef = z.infer<typeof AdminRoleRefSchema>;

export const AdminMeSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: AdminRoleRefSchema,
  status: z.enum(["pending", "active", "suspended", "offboarded"]),
  mfaEnabled: z.boolean(),
  // Permission-id strings (`${resourceType}:${resourceId}:${action}`).
  permissions: z.array(z.string()),
  // resourceIds for menu_item / web_page nav gating (UX only; API still enforces).
  menus: z.array(z.string()),
  pages: z.array(z.string()),
});
export type AdminMe = z.infer<typeof AdminMeSchema>;

export const AdminLoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
  admin: AdminMeSchema,
});
export type AdminLoginResponse = z.infer<typeof AdminLoginResponseSchema>;

export const AdminStepUpRequestSchema = z.object({
  password: z.string().optional(),
  totp: z.string().optional(),
});
export type AdminStepUpRequest = z.infer<typeof AdminStepUpRequestSchema>;

export const AdminMfaEnrollResponseSchema = z.object({
  otpauthUri: z.string(),
  qrSvg: z.string(),
  recoveryCodes: z.array(z.string()),
});
export type AdminMfaEnrollResponse = z.infer<typeof AdminMfaEnrollResponseSchema>;

export const AdminMfaConfirmRequestSchema = z.object({
  totp: z.string().min(6),
});
export type AdminMfaConfirmRequest = z.infer<typeof AdminMfaConfirmRequestSchema>;

export const AdminMfaVerifyRequestSchema = z.object({
  totp: z.string().min(6),
});
export type AdminMfaVerifyRequest = z.infer<typeof AdminMfaVerifyRequestSchema>;
