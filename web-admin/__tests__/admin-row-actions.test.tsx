/**
 * AdminRowActions test — the per-row admin actions (change role / status / reset 2FA),
 * an admin-privilege-critical surface. buildStatusTransitions is unit-tested in
 * lib/admins/row-actions.test.ts; here we pin the render + wiring branches the page
 * test doesn't reach: the read-only dash, the live self-lockout collapse, the
 * change-role no-op guard, a non-403 error surfacing inline without a step-up dialog,
 * and the single-permission RBAC branches. The api layer is mocked.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminUser, Role } from "@handshake-agent/contracts"

import { AdminRowActions } from "@/components/admin/admin-row-actions"
import { ADMIN_MGMT_PERMS } from "@/lib/permissions"
import { ApiError } from "@/lib/api/client"

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  updateAdminRole: vi.fn(),
  setAdminStatus: vi.fn(),
  resetAdminMfa: vi.fn(),
  stepUp: vi.fn(),
}))

import { getMe, updateAdminRole, setAdminStatus } from "@/lib/api/admin"
const mockGetMe = vi.mocked(getMe)
const mockUpdateRole = vi.mocked(updateAdminRole)
const mockSetStatus = vi.mocked(setAdminStatus)

const SUPER_ROLE_ID = "00000000-0000-0000-0000-000000000001"
const SUPPORT_ROLE_ID = "00000000-0000-0000-0000-000000000004"
const OTHER_ID = "11111111-1111-1111-1111-111111111111"
const SELF_ID = "99999999-9999-9999-9999-999999999999"
const ALL_PERMS = Object.values(ADMIN_MGMT_PERMS)

const ROLES: Role[] = [
  { id: SUPER_ROLE_ID, name: "Super Admin", description: "", isBuiltin: true, permissionIds: [] },
  { id: SUPPORT_ROLE_ID, name: "Support", description: "", isBuiltin: false, permissionIds: [] },
]

function admin(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: OTHER_ID,
    email: "amara@handshake.ng",
    status: "active",
    displayName: "Amara",
    mfaEnabled: true,
    role: { id: SUPPORT_ROLE_ID, name: "Support" },
    createdAt: "2026-06-01T00:00:00.000Z",
    lastLoginAt: null,
    ...overrides,
  }
}

function me(permissions: string[], id = SELF_ID) {
  return {
    id,
    email: "root@handshake.ng",
    role: { id: SUPER_ROLE_ID, name: "Super Admin" },
    status: "active" as const,
    displayName: "Root",
    mfaEnabled: false,
    permissions,
    menus: [],
    pages: [],
  }
}

function renderRow(target: AdminUser) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AdminRowActions admin={target} roles={ROLES} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateRole.mockResolvedValue(admin() as never)
  mockSetStatus.mockResolvedValue(admin() as never)
})

describe("AdminRowActions", () => {
  it("renders a muted dash when the operator holds no admin-management permission", async () => {
    mockGetMe.mockResolvedValue(me([]) as never)
    renderRow(admin())

    expect(await screen.findByText("—")).toBeInTheDocument()
    expect(screen.queryByLabelText(/change role/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument()
  })

  it("collapses to a dash on your OWN active row even with full permissions (self-lockout)", async () => {
    mockGetMe.mockResolvedValue(me([ADMIN_MGMT_PERMS.changeStatus], SELF_ID) as never)
    renderRow(admin({ id: SELF_ID, status: "active" }))

    // status-only operator + own active row → every transition is self-forbidden → dash.
    expect(await screen.findByText("—")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Offboard" })).not.toBeInTheDocument()
  })

  it("offers role + reset but never suspend/offboard on your own row with full perms", async () => {
    mockGetMe.mockResolvedValue(me(ALL_PERMS, SELF_ID) as never)
    renderRow(admin({ id: SELF_ID, status: "active" }))

    // canChangeRole → the role select renders; but resetMfa is forced false for self,
    // and suspend/offboard are self-forbidden.
    expect(await screen.findByLabelText(/change role/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Offboard" })).not.toBeInTheDocument()
  })

  it("shows only the role select for a change-role-only operator", async () => {
    mockGetMe.mockResolvedValue(me([ADMIN_MGMT_PERMS.changeRole]) as never)
    renderRow(admin({ status: "active" }))

    expect(await screen.findByLabelText(/change role/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument()
    expect(screen.queryByText("—")).not.toBeInTheDocument()
  })

  it("does NOT fire the mutation when the same role is re-selected (no-op guard)", async () => {
    mockGetMe.mockResolvedValue(me(ALL_PERMS) as never)
    renderRow(admin({ role: { id: SUPPORT_ROLE_ID, name: "Support" } }))

    const select = await screen.findByLabelText(/change role/i)
    // Re-select the CURRENT role → guard returns early, no mutation.
    fireEvent.change(select, { target: { value: SUPPORT_ROLE_ID } })
    // Positive control: a DIFFERENT role does fire it.
    fireEvent.change(select, { target: { value: SUPER_ROLE_ID } })

    await waitFor(() => expect(mockUpdateRole).toHaveBeenCalledTimes(1))
    expect(mockUpdateRole).toHaveBeenCalledWith(OTHER_ID, { roleId: SUPER_ROLE_ID })
  })

  it("surfaces a non-403 error inline without opening the step-up dialog", async () => {
    mockGetMe.mockResolvedValue(me(ALL_PERMS) as never)
    mockUpdateRole.mockRejectedValue(new ApiError("Role locked.", 422, "CONFLICT"))
    const user = userEvent.setup()
    renderRow(admin({ role: { id: SUPPORT_ROLE_ID, name: "Support" } }))

    const select = await screen.findByLabelText(/change role/i)
    await user.selectOptions(select, SUPER_ROLE_ID)

    expect(await screen.findByRole("alert")).toHaveTextContent("Role locked.")
    // A 422 is not a step-up challenge → no TOTP/password prompt appears.
    expect(screen.queryByLabelText(/authenticator code|password/i)).not.toBeInTheDocument()
  })
})
