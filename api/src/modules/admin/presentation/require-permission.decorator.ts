import { SetMetadata } from '@nestjs/common';

/** Metadata key under which a route's required permission is stored. */
export const ADMIN_PERMISSION_KEY = 'admin_permission';

/**
 * Declares the permission a route requires. PermissionGuard reads this metadata
 * and denies (fail-closed) any route that does not declare one (§ default-deny).
 */
export const RequirePermission = (
  resourceType: string,
  resourceId: string,
  action: string,
) => SetMetadata(ADMIN_PERMISSION_KEY, { resourceType, resourceId, action });
