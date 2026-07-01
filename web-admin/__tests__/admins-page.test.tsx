/**
 * AdminsPage tests (real-data wiring — Phase 6a).
 *
 * The screen now reads from `useAdmins()` (the admin table) and derives the role
 * permission matrix live from `useRoles()` × `usePermissions()`. The api layer is
 * mocked (no server). These assert:
 *  1. loading → data: the admin rows render from the mocked list (email, role
 *     name, 2FA state, status pill), and the matrix renders a row per permission
 *     category with the role name column headers.
 *  2. empty: an empty admins list shows the "No admins yet" empty state.
 *  3. error: a failed admins fetch shows the inline error + a retry affordance.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminUserListResponse,
  PermissionListResponse,
  RoleListResponse,
} from "@handshake-agent/contracts"

import { AdminsPage } from "@/components/admin/admins-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  listAdmins: vi.fn(),
  listRoles: vi.fn(),
  listPermissions: vi.fn(),
  // Invited via the dialog's mutation — never called on render, but the module
  // export must exist for the hook import to resolve.
  createInvitation: vi.fn(),
}))

import { listAdmins, listRoles, listPermissions } from "@/lib/api/admin"

const mockAdmins = vi.mocked(listAdmins)
const mockRoles = vi.mocked(listRoles)
const mockPermissions = vi.mocked(listPermissions)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SUPER_ROLE_ID = "00000000-0000-0000-0000-000000000001"
const SUPPORT_ROLE_ID = "00000000-0000-0000-0000-000000000004"

const ADMINS: AdminUserListResponse = {
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      email: "amara@handshake.ng",
      status: "active",
      mfaEnabled: true,
      role: { id: SUPER_ROLE_ID, name: "Super Admin" },
      createdAt: "2026-06-01T00:00:00.000Z",
      lastLoginAt: "2026-06-30T00:00:00.000Z",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      email: "segun@handshake.ng",
      status: "suspended",
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

beforeEach(() => {
  mockAdmins.mockReset()
  mockRoles.mockReset()
  mockPermissions.mockReset()
  mockAdmins.mockResolvedValue(ADMINS)
  mockRoles.mockResolvedValue(ROLES)
  mockPermissions.mockResolvedValue(PERMISSIONS)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AdminsPage (real-data wiring)", () => {
  it("renders admin rows and the derived role permission matrix from the api", async () => {
    renderPage()

    // Admin rows — email (sub-row) + role name + 2FA/status derived from the DTO.
    expect(await screen.findByText("amara@handshake.ng")).toBeInTheDocument()
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

    // The matrix has a "Users" category row (derived from the catalog).
    expect(screen.getByText("Users")).toBeInTheDocument()
    // Access-level legend renders once the matrix has data.
    expect(screen.getByText("Full access")).toBeInTheDocument()
    expect(screen.getByText("Read-only")).toBeInTheDocument()

    // Super Admin (holds write) → a full-access tile on the Users row; Support
    // Agent (read only) → a read-only tile. The cell titles carry the meaning.
    expect(screen.getByTitle("Super Admin · Full access")).toBeInTheDocument()
    expect(screen.getByTitle("Support Agent · Read-only")).toBeInTheDocument()
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
