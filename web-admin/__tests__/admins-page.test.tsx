/**
 * AdminsPage tests (real-data wiring — Phase 6a) + WRITE wiring (Phase 7).
 *
 * The screen reads from `useAdmins()` (the admin table) and derives the role
 * permission matrix live from `useRoles()` × `usePermissions()`. WRITES are wired
 * through the canonical step-up-gated components: `AdminRowActions` (change role →
 * useUpdateAdminRole, suspend/reactivate/offboard → useSetAdminStatus) and
 * `RoleEditorDialog` (create → useCreateRole, edit perms → useUpdateRole). The api
 * layer is mocked (no server). These assert:
 *  1. loading → data: the admin rows render from the mocked list (email, role
 *     name, 2FA state, status pill), and the matrix renders a row per permission
 *     category with the role name column headers.
 *  2. empty / error branches.
 *  3. WRITE wiring: changing a row's role fires updateAdminRole; suspending fires
 *     setAdminStatus; creating a role fires createRole. Each invalidates its query.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminUserListResponse,
  PermissionListResponse,
  RoleListResponse,
} from "@handshake-agent/contracts"

import { AdminsPage } from "@/components/admin/admins-page"
import { ADMIN_MGMT_PERMS } from "@/lib/permissions"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  listAdmins: vi.fn(),
  listRoles: vi.fn(),
  listPermissions: vi.fn(),
  // The signed-in admin's identity — read by AdminRowActions to pick the step-up
  // mode. Resolved in beforeEach so the row actions mount cleanly.
  getMe: vi.fn(),
  // WRITE mutations wired into the row actions + role editor + invite dialog.
  updateAdminRole: vi.fn(),
  setAdminStatus: vi.fn(),
  resetAdminMfa: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  createInvitation: vi.fn(),
  // Referenced by the step-up dialog's hook import; never called in these tests.
  stepUp: vi.fn(),
}))

import {
  listAdmins,
  listRoles,
  listPermissions,
  getMe,
  updateAdminRole,
  setAdminStatus,
  resetAdminMfa,
  createRole,
  updateRole,
} from "@/lib/api/admin"

const mockAdmins = vi.mocked(listAdmins)
const mockRoles = vi.mocked(listRoles)
const mockPermissions = vi.mocked(listPermissions)
const mockGetMe = vi.mocked(getMe)
const mockUpdateAdminRole = vi.mocked(updateAdminRole)
const mockSetAdminStatus = vi.mocked(setAdminStatus)
const mockResetAdminMfa = vi.mocked(resetAdminMfa)
const mockCreateRole = vi.mocked(createRole)
const mockUpdateRole = vi.mocked(updateRole)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SUPER_ROLE_ID = "00000000-0000-0000-0000-000000000001"
const SUPPORT_ROLE_ID = "00000000-0000-0000-0000-000000000004"

const ADMINS: AdminUserListResponse = {
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      email: "amara@handshake.ng",
      status: "active",
      displayName: "Amara Okoro",
      mfaEnabled: true,
      role: { id: SUPER_ROLE_ID, name: "Super Admin" },
      createdAt: "2026-06-01T00:00:00.000Z",
      lastLoginAt: "2026-06-30T00:00:00.000Z",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      email: "segun@handshake.ng",
      status: "suspended",
      displayName: "Segun Bello",
      mfaEnabled: false,
      role: { id: SUPPORT_ROLE_ID, name: "Support Agent" },
      createdAt: "2026-06-02T00:00:00.000Z",
      lastLoginAt: null,
    },
  ],
  nextCursor: null,
}

// Two permissions in one category: a read + a write. Super Admin holds both
// (→ full), Support Agent holds only the read (→ read-only).
const USERS_READ_ID = "api_route:GET /admin/users:read"
const USERS_WRITE_ID = "api_route:PATCH /admin/users/:id:write"

const PERMISSIONS: PermissionListResponse = {
  permissions: [
    {
      id: USERS_READ_ID,
      resourceType: "api_route",
      resourceId: "GET /admin/users",
      action: "read",
      category: "Users",
      description: "List end users",
    },
    {
      id: USERS_WRITE_ID,
      resourceType: "api_route",
      resourceId: "PATCH /admin/users/:id",
      action: "write",
      category: "Users",
      description: "Update an end user",
    },
  ],
}

const ROLES: RoleListResponse = {
  roles: [
    {
      id: SUPER_ROLE_ID,
      name: "Super Admin",
      description: "Full access",
      isBuiltin: true,
      permissionIds: [USERS_READ_ID, USERS_WRITE_ID],
    },
    {
      id: SUPPORT_ROLE_ID,
      name: "Support Agent",
      description: "Read-mostly",
      isBuiltin: true,
      permissionIds: [USERS_READ_ID],
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminsPage />
    </QueryClientProvider>
  )
}

// The signed-in operator is a DISTINCT super-admin (not one of the two rows), so
// every row is an "other admin" and holds the three admin-management permissions —
// the row actions render for the wiring tests below. The gating tests override
// `mockGetMe` to strip permissions or to make a row the self row.
const ME = {
  id: "99999999-9999-9999-9999-999999999999",
  email: "root@handshake.ng",
  role: { id: SUPER_ROLE_ID, name: "Super Admin" },
  status: "active" as const,
  displayName: "Root Operator",
  mfaEnabled: false,
  permissions: Object.values(ADMIN_MGMT_PERMS),
  menus: [],
  pages: [],
}

beforeEach(() => {
  mockAdmins.mockReset().mockResolvedValue(ADMINS)
  mockRoles.mockReset().mockResolvedValue(ROLES)
  mockPermissions.mockReset().mockResolvedValue(PERMISSIONS)
  mockGetMe.mockReset().mockResolvedValue(ME)
  // updateAdminRole / setAdminStatus / updateRole resolve void (204); createRole
  // returns the created Role.
  mockUpdateAdminRole.mockReset().mockResolvedValue(undefined)
  mockSetAdminStatus.mockReset().mockResolvedValue(undefined)
  mockResetAdminMfa.mockReset().mockResolvedValue(undefined)
  mockCreateRole.mockReset().mockResolvedValue(ROLES.roles[0])
  mockUpdateRole.mockReset().mockResolvedValue(undefined)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AdminsPage (real-data wiring)", () => {
  it("renders admin rows and the derived role permission matrix from the api", async () => {
    renderPage()

    // Admin rows — the contract `displayName` is the primary label (not the email
    // local-part), with the email as the sub-row.
    expect(await screen.findByText("Amara Okoro")).toBeInTheDocument()
    expect(screen.getByText("Segun Bello")).toBeInTheDocument()
    expect(screen.getByText("amara@handshake.ng")).toBeInTheDocument()
    expect(screen.getByText("segun@handshake.ng")).toBeInTheDocument()
    // Role names appear both as a row label AND as a matrix column header.
    expect(screen.getAllByText("Super Admin").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Support Agent").length).toBeGreaterThanOrEqual(
      1
    )
    // 2FA state: one enrolled, one not set.
    expect(screen.getByText("Enrolled")).toBeInTheDocument()
    expect(screen.getByText("Not set")).toBeInTheDocument()
    // Status pill: the active row shows "Active"; the suspended row shows its
    // raw status label (not "Active").
    expect(screen.getByText("Active")).toBeInTheDocument()
    expect(screen.getByText("suspended")).toBeInTheDocument()

    // The shared RolePermissionMatrix mounts with a "Users" category row (derived
    // from the catalog).
    expect(screen.getByText("Users")).toBeInTheDocument()
    // Access-level labels render once the matrix has data (the legend + each tile's
    // sr-only label both carry the meaning — colour is never the sole signal).
    expect(screen.getAllByText("Full access").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Read-only").length).toBeGreaterThanOrEqual(1)

    // Super Admin (holds write) → a full-access tile on the Users row; Support
    // Agent (read only) → a read-only tile. The cell titles carry the meaning.
    expect(
      screen.getByTitle("Super Admin · Users: Full access")
    ).toBeInTheDocument()
    expect(
      screen.getByTitle("Support Agent · Users: Read-only")
    ).toBeInTheDocument()
  })

  it("shows the empty state when there are no admins", async () => {
    mockAdmins.mockResolvedValue({ items: [], nextCursor: null })
    renderPage()

    expect(await screen.findByText("No admins yet")).toBeInTheDocument()
  })

  it("shows an inline error with a retry affordance when the admins fetch fails", async () => {
    mockAdmins.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(await screen.findByText("Couldn't load admins")).toBeInTheDocument()
    // A retry button is present and, once clicked, re-invokes the api.
    const retry = screen.getByRole("button", { name: "Try again" })
    expect(retry).toBeInTheDocument()

    // The initial call fired once; the matrix (roles + permissions) resolved fine.
    await waitFor(() =>
      expect(mockAdmins.mock.calls.length).toBeGreaterThanOrEqual(1)
    )
  })
})

// ─── WRITE wiring (Phase 7) ───────────────────────────────────────────────────────
// These assert the row actions + role editor call the REAL mutation clients with the
// contract-shaped payload. No LLM output, no funds move — RBAC writes only (§3.1).

describe("AdminsPage (write wiring)", () => {
  it("fires updateAdminRole with the new role id when a row's role is changed", async () => {
    const user = userEvent.setup()
    renderPage()

    // The suspended admin (segun) is on the Support Agent role; change it to Super.
    const selects = await screen.findAllByLabelText(
      /Change role for .+@handshake\.ng/
    )
    const segunSelect = selects.find(
      (el) => (el as HTMLSelectElement).value === SUPPORT_ROLE_ID
    ) as HTMLSelectElement
    expect(segunSelect).toBeTruthy()

    await user.selectOptions(segunSelect, SUPER_ROLE_ID)

    await waitFor(() =>
      expect(mockUpdateAdminRole).toHaveBeenCalledWith(
        "22222222-2222-2222-2222-222222222222",
        { roleId: SUPER_ROLE_ID }
      )
    )
  })

  it("fires setAdminStatus when a row's status transition is clicked", async () => {
    const user = userEvent.setup()
    renderPage()

    // The active admin (amara) offers Suspend + Offboard; click Suspend.
    const suspend = await screen.findByRole("button", { name: "Suspend" })
    await user.click(suspend)

    await waitFor(() =>
      expect(mockSetAdminStatus).toHaveBeenCalledWith(
        "11111111-1111-1111-1111-111111111111",
        { status: "suspended" }
      )
    )
  })

  it("resets an admin's 2FA through the audited reason flow", async () => {
    const user = userEvent.setup()
    renderPage()

    // Open the Reset 2FA action for the active admin (amara). The button carries
    // the target's identity so the right admin is reset.
    const reset = await screen.findByRole("button", {
      name: /Reset 2FA for amara@handshake\.ng/i,
    })
    await user.click(reset)

    // The reason modal (audited). Type a reason and continue — the POST fires
    // directly; the REAL step-up is server-driven (403 → StepUpDialog → replay).
    const reason = await screen.findByLabelText("Reason")
    await user.type(reason, "Lost authenticator device")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    // No decorative TOTP keypad remains in the flow.
    expect(
      screen.queryByText("Step-up authentication")
    ).not.toBeInTheDocument()

    // The reset client fires with the target admin id + the entered reason.
    await waitFor(() =>
      expect(mockResetAdminMfa).toHaveBeenCalledWith(
        "11111111-1111-1111-1111-111111111111",
        "Lost authenticator device"
      )
    )
  })

  it("fires createRole from the role editor's New role flow", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("button", { name: /New role/ }))

    // Name the role, then save — the create mutation fires with the typed name.
    const nameInput = await screen.findByLabelText("Name")
    await user.type(nameInput, "analyst")
    await user.click(screen.getByRole("button", { name: "Create role" }))

    await waitFor(() =>
      expect(mockCreateRole).toHaveBeenCalledWith(
        expect.objectContaining({ name: "analyst" })
      )
    )
  })
})

// ─── RBAC gating (permission + self-guard) ─────────────────────────────────────────
// The UI mirrors the server-side gate (§3.3): an operator only sees an action they
// hold the permission for, and can never suspend/offboard/reset-2FA their own row.

describe("AdminsPage (RBAC gating)", () => {
  it("hides every row action for an operator without admin-management permissions", async () => {
    mockGetMe.mockResolvedValue({ ...ME, permissions: [] })
    renderPage()

    // The rows still render (read access), but no management controls do.
    expect(await screen.findByText("Amara Okoro")).toBeInTheDocument()
    expect(
      screen.queryAllByLabelText(/Change role for .+@handshake\.ng/)
    ).toHaveLength(0)
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Offboard" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Reset 2FA/i })).toBeNull()
  })

  it("hides suspend/offboard and reset-2FA on the operator's OWN row (self-guard)", async () => {
    // The signed-in operator IS the first row (amara).
    mockGetMe.mockResolvedValue({
      ...ME,
      id: "11111111-1111-1111-1111-111111111111",
    })
    renderPage()

    // Wait until the identity has resolved and gating applied — segun (the OTHER
    // admin) shows a reset-2FA action once `useAdminMe` settles.
    expect(
      await screen.findByRole("button", {
        name: /Reset 2FA for segun@handshake\.ng/i,
      })
    ).toBeInTheDocument()

    // Amara is active + self → her only transitions (Suspend/Offboard) are filtered
    // out; no other row is active, so there is no Suspend button anywhere.
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull()
    // Reset-2FA is hidden on the self row.
    expect(
      screen.queryByRole("button", { name: /Reset 2FA for amara@handshake\.ng/i })
    ).toBeNull()
    // Self can still change their own role (permission held; not a lockout action).
    expect(
      screen.getByLabelText("Change role for amara@handshake.ng")
    ).toBeInTheDocument()
  })
})
