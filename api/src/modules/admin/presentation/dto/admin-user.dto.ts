import { createZodDto } from 'nestjs-zod';
import {
  AdminMfaResetRequestSchema,
  AdminUserStatusRequestSchema,
  AdminUserUpdateRoleRequestSchema,
} from '@handshake-agent/contracts';

/** Request DTO for PATCH /admin/admins/:id/role. */
export class AdminUserRoleDto extends createZodDto(
  AdminUserUpdateRoleRequestSchema,
) {}

/** Request DTO for PATCH /admin/admins/:id/status. */
export class AdminUserStatusDto extends createZodDto(
  AdminUserStatusRequestSchema,
) {}

/** Request DTO for POST /admin/admins/:id/mfa/reset (carries the audited reason). */
export class AdminMfaResetDto extends createZodDto(
  AdminMfaResetRequestSchema,
) {}
