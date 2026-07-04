import type { AdminMe } from "@handshake-agent/contracts"
import { describe, expect, it } from "vitest"

import { ADMIN_MGMT_PERMS, adminMgmtAccess } from "./permissions"

function makeMe(over: Partial<AdminMe>): AdminMe {
  return {
    id: "me-1",
    email: "me@handshake.local",
    displayName: "Me",
    role: { id: "role-1", name: "Super Admin" },
    status: "active",
    mfaEnabled: false,
    permissions: [],
    menus: [],
    pages: [],
    ...over,
  }
}

describe("adminMgmtAccess", () => {
  it("grants each action when the matching permission is present (other admin)", () => {
    const me = makeMe({
      permissions: [
        ADMIN_MGMT_PERMS.changeRole,
        ADMIN_MGMT_PERMS.changeStatus,
        ADMIN_MGMT_PERMS.resetMfa,
      ],
    })
    expect(adminMgmtAccess(me, "other")).toEqual({
      isSelf: false,
      canChangeRole: true,
      canChangeStatus: true,
      canResetMfa: true,
    })
  })

  it("denies every action for an operator with no admin-mgmt permissions", () => {
    expect(adminMgmtAccess(makeMe({ permissions: [] }), "other")).toEqual({
      isSelf: false,
      canChangeRole: false,
      canChangeStatus: false,
      canResetMfa: false,
    })
  })

  it("marks the self row and forbids reset-2FA on yourself even with the permission", () => {
    const me = makeMe({
      id: "me-1",
      permissions: [ADMIN_MGMT_PERMS.resetMfa, ADMIN_MGMT_PERMS.changeStatus],
    })
    const access = adminMgmtAccess(me, "me-1")
    expect(access.isSelf).toBe(true)
    expect(access.canResetMfa).toBe(false)
    // The status permission is still reported; suspend/offboard-self is filtered
    // per-transition by the caller, not here.
    expect(access.canChangeStatus).toBe(true)
  })

  it("treats an undefined identity as no access", () => {
    expect(adminMgmtAccess(undefined, "x")).toEqual({
      isSelf: false,
      canChangeRole: false,
      canChangeStatus: false,
      canResetMfa: false,
    })
  })
})
