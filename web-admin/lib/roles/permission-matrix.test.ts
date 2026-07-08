import { describe, expect, it } from "vitest"
import {
  ADMIN_PERMISSION_CATEGORIES,
  permissionId,
  type AdminPermissionRecord,
  type Role,
} from "@handshake-agent/contracts"

import { buildMatrixRows, levelFor, roleLabel } from "./permission-matrix"

const CATEGORY = ADMIN_PERMISSION_CATEGORIES[0]

const READ_PERM: AdminPermissionRecord = {
  id: "00000000-0000-0000-0000-000000000001",
  resourceType: "api_route",
  resourceId: "GET /admin/x",
  action: "read",
  category: CATEGORY,
  description: "Read x",
}
const WRITE_PERM: AdminPermissionRecord = {
  id: "00000000-0000-0000-0000-000000000002",
  resourceType: "api_route",
  resourceId: "PATCH /admin/x",
  action: "write",
  category: CATEGORY,
  description: "Write x",
}
const PERMS = [READ_PERM, WRITE_PERM]

function role(permissionIds: string[]): Role {
  return {
    id: "r-1",
    name: "custom_role",
    description: "",
    isBuiltin: false,
    permissionIds,
  }
}

describe("levelFor", () => {
  it("is 'full' when the role holds any elevated action", () => {
    expect(levelFor(role([permissionId(WRITE_PERM)]), CATEGORY, PERMS)).toBe(
      "full"
    )
  })
  it("is 'read' when the role holds only reads", () => {
    expect(levelFor(role([permissionId(READ_PERM)]), CATEGORY, PERMS)).toBe(
      "read"
    )
  })
  it("is 'none' when the role holds nothing in the category", () => {
    expect(levelFor(role([]), CATEGORY, PERMS)).toBe("none")
  })
})

describe("roleLabel", () => {
  it("title-cases snake_case / kebab / spaced names", () => {
    expect(roleLabel("super_admin")).toBe("Super Admin")
    expect(roleLabel("read-only")).toBe("Read Only")
  })
})

describe("buildMatrixRows", () => {
  it("emits a row only for present categories, with per-role cells", () => {
    const rows = buildMatrixRows(
      [role([permissionId(WRITE_PERM)]), role([])],
      PERMS
    )
    const row = rows.find((r) => r.label === CATEGORY)
    expect(row?.cells).toEqual(["full", "none"])
  })
})
