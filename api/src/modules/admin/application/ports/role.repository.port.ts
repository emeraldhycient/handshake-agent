// Port for roles (ADM-03/ADM-04). A role is a named permission set; built-in roles
// (e.g. Super Admin) are immutable. `permissionIds` everywhere on this port are the
// canonical catalog id strings (`resourceType:resourceId:action`), NOT raw row uuids —
// the repository resolves them to Permission rows and back.

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

export interface CreateRoleInput {
  name: string;
  description: string;
  isBuiltin: boolean;
  /** Canonical catalog ids; ids with no matching Permission are ignored. */
  permissionIds: string[];
}

export interface UpdateRoleInput {
  description?: string;
  /** When given, the role's assignments are fully replaced with these. */
  permissionIds?: string[];
}

export interface RoleRecord {
  id: string;
  name: string;
  description: string;
  isBuiltin: boolean;
}

export interface RoleWithPermissions extends RoleRecord {
  /** Canonical `resourceType:resourceId:action` strings of the assigned permissions. */
  permissionIds: string[];
}

export interface IRoleRepository {
  create(input: CreateRoleInput): Promise<RoleRecord>;
  findById(id: string): Promise<RoleWithPermissions | null>;
  findByName(name: string): Promise<RoleWithPermissions | null>;
  list(): Promise<RoleWithPermissions[]>;
  update(id: string, input: UpdateRoleInput): Promise<void>;
  countAdmins(roleId: string): Promise<number>;
}
