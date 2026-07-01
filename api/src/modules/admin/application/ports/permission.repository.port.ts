// Port for the permission catalog (ADM-04) — the single source of truth guarding API
// routes, web pages, and menu items. The catalog is seeded idempotently via
// `upsertCatalog`, keyed by the unique (resourceType, resourceId, action) triple.

export const PERMISSION_REPOSITORY = Symbol('PERMISSION_REPOSITORY');

export type PermissionResourceType = 'api_route' | 'web_page' | 'menu_item';
export type PermissionActionValue = 'read' | 'write' | 'delete' | 'execute';

export interface PermissionCatalogEntry {
  resourceType: PermissionResourceType;
  resourceId: string;
  action: PermissionActionValue;
  category: string;
  description: string;
}

export interface PermissionRecord {
  id: string;
  resourceType: PermissionResourceType;
  resourceId: string;
  action: PermissionActionValue;
  category: string;
  description: string;
}

export interface IPermissionRepository {
  /**
   * Idempotent upsert of the catalog, keyed by [resourceType, resourceId, action].
   * Running it twice yields the same row set; description/category are refreshed.
   */
  upsertCatalog(entries: PermissionCatalogEntry[]): Promise<void>;
  list(): Promise<PermissionRecord[]>;
  findByRole(roleId: string): Promise<PermissionRecord[]>;
}

/** The canonical catalog id string for a permission: `resourceType:resourceId:action`. */
export function permissionCatalogId(p: {
  resourceType: PermissionResourceType;
  resourceId: string;
  action: PermissionActionValue;
}): string {
  return `${p.resourceType}:${p.resourceId}:${p.action}`;
}
