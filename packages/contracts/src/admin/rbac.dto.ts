import { z } from "zod";

// RBAC management DTOs — the permission catalog record (a persisted view of a
// `PERMISSION_CATALOG` entry, with its id), roles (built-in or custom) and their
// granted permission ids, plus the create / update / list request/response shapes.

export const AdminPermissionRecordSchema = z.object({
  id: z.string().uuid(),
  resourceType: z.enum(["api_route", "web_page", "menu_item"]),
  resourceId: z.string(),
  action: z.enum(["read", "write", "delete", "execute"]),
  category: z.string(),
  description: z.string(),
});
export type AdminPermissionRecord = z.infer<typeof AdminPermissionRecordSchema>;

export const RoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  isBuiltin: z.boolean(),
  permissionIds: z.array(z.string()),
});
export type Role = z.infer<typeof RoleSchema>;

export const RoleCreateRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  permissionIds: z.array(z.string()),
});
export type RoleCreateRequest = z.infer<typeof RoleCreateRequestSchema>;

export const RoleUpdateRequestSchema = z.object({
  description: z.string().min(1).optional(),
  permissionIds: z.array(z.string()).optional(),
});
export type RoleUpdateRequest = z.infer<typeof RoleUpdateRequestSchema>;

export const RoleListResponseSchema = z.object({
  roles: z.array(RoleSchema),
});
export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;

export const PermissionListResponseSchema = z.object({
  permissions: z.array(AdminPermissionRecordSchema),
});
export type PermissionListResponse = z.infer<
  typeof PermissionListResponseSchema
>;
