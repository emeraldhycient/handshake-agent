/**
 * Step-up flow test.
 *
 * A sensitive mutation (change admin role) that 403s with code
 * ADMIN_STEP_UP_REQUIRED opens the StepUpDialog. After a successful step-up the
 * stashed mutation is retried. The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminMe, AdminUser, Role } from "@handshake-agent/contracts"

import { AdminRowActions } from "@/components/admin/admin-row-actions"
import { ApiError } from "@/lib/api/client"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  updateAdminRole: vi.fn(),
  setAdminStatus: vi.fn(),
  stepUp: vi.fn(),
}))

import { getMe, updateAdminRole, stepUp } from "@/lib/api/admin"
const mockGetMe = vi.mocked(getMe)
const mockUpdateRole = vi.mocked(updateAdminRole)
const mockStepUp = vi.mocked(stepUp)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ME: AdminMe = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "me@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000ff", name: "super_admin" },
  status: "active",
  displayName: "Test Admin",
  mfaEnabled: false, // → step-up asks for a password
  permissions: [],
  menus: ["menu.access"],
  pages: ["/admin/admins"],
}

const TARGET: AdminUser = {
  id: "00000000-0000-0000-0000-000000000099",
  email: "target@example.com",
  status: "active",
  displayName: "Test Admin",
  mfaEnabled: false,
  role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
  createdAt: new Date().toISOString(),
  lastLoginAt: null,
}

const ROLES: Role[] = [
  {
    id: "00000000-0000-0000-0000-0000000000aa",
    name: "ops",
    description: "ops",
    isBuiltin: true,
    permissionIds: [],
  },
  {
    id: "00000000-0000-0000-0000-0000000000bb",
    name: "compliance",
    description: "compliance",
    isBuiltin: true,
    permissionIds: [],
  },
]

function renderActions() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminRowActions admin={TARGET} roles={ROLES} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetMe.mockReset()
  mockUpdateRole.mockReset()
  mockStepUp.mockReset()
  mockGetMe.mockResolvedValue(ME)
})

describe("Step-up flow", () => {
  it("opens the step-up dialog on ADMIN_STEP_UP_REQUIRED, then retries after re-auth", async () => {
    // First role change 403s with the step-up code; the retry (after step-up)
    // succeeds.
    mockUpdateRole
      .mockRejectedValueOnce(
        new ApiError("Re-auth required.", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(undefined)
    mockStepUp.mockResolvedValue(undefined)

    const user = userEvent.setup()
    renderActions()

    // Wait for useAdminMe so mfaEnabled is known to the dialog.
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled())

    // Change the role → triggers the first (rejected) mutation.
    await user.selectOptions(
      screen.getByLabelText(/change role for target@example.com/i),
      "00000000-0000-0000-0000-0000000000bb"
    )

    // The step-up dialog opens (password field, since mfaEnabled=false).
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent(/confirm it's you/i)
    const passwordField = await screen.findByLabelText(/^password$/i)

    // Re-authenticate.
    await user.type(passwordField, "supersecret")
    await user.click(screen.getByRole("button", { name: /^confirm$/i }))

    // step-up was called, then the role mutation was retried (2 total calls).
    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockUpdateRole).toHaveBeenCalledTimes(2))
  })
})
