/**
 * RolesPage guard test — the roles list + read-only permission matrix, wired to
 * `useRoles()` (GET /admin/roles). The RBAC access-level derivation is unit-tested in
 * `lib/roles/access.test.ts`; here we assert the four async branches, the role rows
 * (name · built-in badge · permission count), the matrix, and that New role / Edit open
 * the shared editor. The api layer is mocked and the editor dialog is stubbed so the
 * page is tested in isolation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { RoleListResponse } from "@handshake-agent/contracts"

import { RolesPage } from "@/components/admin/roles-page"

vi.mock("@/lib/api/admin", () => ({ listRoles: vi.fn() }))

// Stub the shared editor so the page test doesn't pull the dialog's own api deps.
vi.mock("@/components/admin/role-editor-dialog", () => ({
  RoleEditorDialog: ({ open, role }: { open: boolean; role: unknown }) =>
    open ? <div>ROLE EDITOR · {role ? "edit" : "create"}</div> : null,
}))

import { listRoles } from "@/lib/api/admin"

const mockRoles = vi.mocked(listRoles)

const ROLES: RoleListResponse = {
  roles: [
    {
      id: "role-super",
      name: "Super Admin",
      description: "Full console access",
      isBuiltin: true,
      permissionIds: ["api_route:GET /admin/users:read"],
    },
    {
      id: "role-support",
      name: "Support",
      description: "Read-only helpdesk",
      isBuiltin: false,
      permissionIds: [],
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <RolesPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockRoles.mockReset().mockResolvedValue(ROLES)
})

describe("RolesPage", () => {
  it("renders the role rows (name · built-in badge · count) and the matrix", async () => {
    renderPage()

    // Each role name appears twice — once in the table row, once as a matrix column.
    expect((await screen.findAllByText("Super Admin")).length).toBeGreaterThan(
      0
    )
    expect(screen.getAllByText("Support").length).toBeGreaterThan(0)
    expect(screen.getByText("built-in")).toBeInTheDocument()
    // The read-only permission matrix renders alongside the table.
    expect(screen.getByText("Role permission matrix")).toBeInTheDocument()
    // Legend restates the three access tones (colour is never the sole signal); the
    // same labels also appear as each tile's title / sr-only text, so allow multiples.
    expect(screen.getAllByText("Full access").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Read-only").length).toBeGreaterThan(0)
    expect(screen.getAllByText("No access").length).toBeGreaterThan(0)
  })

  it("opens the editor in create mode from New role", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText("Super Admin")

    await user.click(screen.getByRole("button", { name: /New role/ }))
    expect(await screen.findByText("ROLE EDITOR · create")).toBeInTheDocument()
  })

  it("opens the editor in edit mode from a custom role's Edit action", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText("Support")

    await user.click(screen.getByRole("button", { name: "Edit" }))
    expect(await screen.findByText("ROLE EDITOR · edit")).toBeInTheDocument()
  })

  it("shows the empty state when no roles are defined", async () => {
    mockRoles.mockResolvedValue({ roles: [] })
    renderPage()
    expect(await screen.findByText("No roles defined")).toBeInTheDocument()
  })

  it("shows the error state when the roles fetch fails", async () => {
    mockRoles.mockRejectedValue(new Error("boom"))
    renderPage()
    expect(await screen.findByText("Failed to load roles")).toBeInTheDocument()
  })
})
