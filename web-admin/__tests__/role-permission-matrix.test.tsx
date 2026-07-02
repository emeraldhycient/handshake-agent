/**
 * RolePermissionMatrix — resolves each cell's access level from a role's granted
 * CANONICAL permission ids (`${resourceType}:${resourceId}:${action}`) against the
 * permission catalog. Regression guard: role.permissionIds are canonical strings,
 * NOT the catalog row's UUID — matching on the UUID resolves every cell to "No
 * access" (the Phase 8 bug this test locks out).
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { AdminPermissionRecord, Role } from "@handshake-agent/contracts"

import { RolePermissionMatrix } from "@/components/admin/role-permission-matrix"

// A catalog entry whose UUID id differs from its canonical id.
function perm(
  resourceId: string,
  action: AdminPermissionRecord["action"],
  category: string
): AdminPermissionRecord {
  return {
    id: `uuid-${resourceId}-${action}`,
    resourceType: "api_route",
    resourceId,
    action,
    category: category as AdminPermissionRecord["category"],
    description: `${action} ${resourceId}`,
  }
}

const PERMISSIONS: AdminPermissionRecord[] = [
  perm("GET /admin/users", "read", "Users"),
  perm("PATCH /admin/users/:id/status", "write", "Users"),
  perm("GET /admin/audit", "read", "Audit"),
]

// full = holds a write in Users; read-only in Audit; nothing in Users for the
// second role. permissionIds are the CANONICAL ids, never the catalog UUIDs.
const ROLES: Role[] = [
  {
    id: "role-super",
    name: "super_admin",
    description: "Full access",
    isBuiltin: true,
    permissionIds: [
      "api_route:GET /admin/users:read",
      "api_route:PATCH /admin/users/:id/status:write",
      "api_route:GET /admin/audit:read",
    ],
  },
  {
    id: "role-support",
    name: "support",
    description: "Support",
    isBuiltin: true,
    permissionIds: ["api_route:GET /admin/audit:read"],
  },
]

describe("RolePermissionMatrix", () => {
  it("resolves a role's elevated grant to Full access (canonical id, not UUID)", () => {
    render(<RolePermissionMatrix roles={ROLES} permissions={PERMISSIONS} />)

    // super_admin holds a write in Users → Full access (the bug rendered No access).
    expect(
      screen.getByTitle("Super Admin · Users: Full access")
    ).toBeInTheDocument()
    // super_admin holds only a read in Audit → Read-only.
    expect(
      screen.getByTitle("Super Admin · Audit: Read-only")
    ).toBeInTheDocument()
    // support holds nothing in Users → No access.
    expect(
      screen.getByTitle("Support · Users: No access")
    ).toBeInTheDocument()
  })
})
