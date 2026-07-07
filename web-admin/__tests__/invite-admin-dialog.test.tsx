/**
 * InviteAdminDialog test — the two-phase invite dialog (email + role → one-time
 * token). Asserts the composed behavior: a valid submit posts { email, roleId } and
 * then the success view reveals the one-time token, an empty email is blocked inline
 * (no mutation), and a server error surfaces. The api layer is mocked.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { Role } from "@handshake-agent/contracts"

import { InviteAdminDialog } from "@/components/admin/invite-admin-dialog"
import { ApiError } from "@/lib/api/client"

vi.mock("@/lib/api/admin", () => ({ createInvitation: vi.fn() }))

import { createInvitation } from "@/lib/api/admin"
const mockCreate = vi.mocked(createInvitation)

const ROLES: Role[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "ops",
    description: "",
    isBuiltin: false,
    permissionIds: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "support",
    description: "",
    isBuiltin: false,
    permissionIds: [],
  },
]

function renderDialog() {
  const onOpenChange = vi.fn()
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <InviteAdminDialog
        open
        onOpenChange={onOpenChange as never}
        roles={ROLES}
      />
    </QueryClientProvider>
  )
  return onOpenChange
}

beforeEach(() => {
  mockCreate.mockReset()
})

describe("InviteAdminDialog", () => {
  it("posts { email, roleId } and reveals the one-time token on success", async () => {
    mockCreate.mockResolvedValue({
      email: "new.admin@example.com",
      invitationToken: "tok_abc123",
    } as never)
    const user = userEvent.setup()
    renderDialog()

    await user.type(
      screen.getByLabelText("Email address"),
      "new.admin@example.com"
    )
    await user.click(screen.getByRole("button", { name: /send invitation/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        email: "new.admin@example.com",
        roleId: ROLES[0].id,
      })
    )
    expect(await screen.findByText("tok_abc123")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument()
  })

  it("blocks an empty email inline without calling the api", async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole("button", { name: /send invitation/i }))

    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("surfaces a server error", async () => {
    mockCreate.mockRejectedValue(
      new ApiError("Email already invited.", 409, "ADMIN_INVITE_CONFLICT")
    )
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText("Email address"), "dup@example.com")
    await user.click(screen.getByRole("button", { name: /send invitation/i }))

    expect(await screen.findByText("Email already invited.")).toBeInTheDocument()
  })
})
