/**
 * RoleEditorDialog test — the role create/edit permission-matrix editor. The
 * PERMISSION_GROUPS grouping is unit-tested in `lib/roles/permission-groups.test.ts`;
 * here we assert the composed dialog: create POSTs {name, description, permissionIds},
 * edit PATCHes {description, permissionIds} keyed by the role id, and a built-in role is
 * read-only (disabled controls + no save). The api layer is mocked (no server).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  PERMISSION_CATALOG,
  permissionId,
  type Role,
} from "@handshake-agent/contracts"

import { RoleEditorDialog } from "@/components/admin/role-editor-dialog"

vi.mock("@/lib/api/admin", () => ({
  createRole: vi.fn(),
  updateRole: vi.fn(),
}))

import { createRole, updateRole } from "@/lib/api/admin"

const mockCreate = vi.mocked(createRole)
const mockUpdate = vi.mocked(updateRole)

const SEED_ID = permissionId(PERMISSION_CATALOG[0])

const CUSTOM_ROLE: Role = {
  id: "role-1",
  name: "Analyst",
  description: "Read-only analyst",
  isBuiltin: false,
  permissionIds: [SEED_ID],
}

function renderDialog(role: Role | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <RoleEditorDialog open onOpenChange={vi.fn()} role={role} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue(CUSTOM_ROLE)
  mockUpdate.mockReset().mockResolvedValue(undefined as never)
})

describe("RoleEditorDialog", () => {
  it("creates a role with the selected permissions", async () => {
    const user = userEvent.setup()
    renderDialog(null)

    expect(
      screen.getByRole("heading", { name: "Create role" })
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText("Name"), "analyst")
    await user.type(screen.getByLabelText("Description"), "does analysis")
    await user.click(screen.getAllByRole("checkbox")[0])
    await user.click(screen.getByRole("button", { name: "Create role" }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    const arg = mockCreate.mock.calls[0][0]
    expect(arg.name).toBe("analyst")
    expect(arg.description).toBe("does analysis")
    expect(arg.permissionIds).toHaveLength(1)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("edits a role (PATCH description + permissionIds; no Name field)", async () => {
    const user = userEvent.setup()
    renderDialog(CUSTOM_ROLE)

    expect(screen.getByText("Edit role: Analyst")).toBeInTheDocument()
    expect(screen.queryByLabelText("Name")).toBeNull()

    await user.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith("role-1", {
      description: "Read-only analyst",
      permissionIds: [SEED_ID],
    })
  })

  it("renders a built-in role read-only (disabled controls, no save)", async () => {
    renderDialog({ ...CUSTOM_ROLE, isBuiltin: true, name: "Super Admin" })

    expect(
      screen.getByText(/built-in role and cannot be modified/i)
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Description")).toBeDisabled()
    expect(screen.getAllByRole("checkbox")[0]).toBeDisabled()
    // Read-only → no save action, only the Close/Cancel footer button.
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Create role" })).toBeNull()
  })
})
