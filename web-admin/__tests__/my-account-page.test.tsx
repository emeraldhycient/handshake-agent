/**
 * MyAccountPage — the self-service profile surface. Verifies the operator's
 * identity renders read-only, the editable display name seeds from `useAdminMe`,
 * and saving fires `updateOwnProfile` (PATCH /admin/me) with the new name.
 */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MyAccountPage } from "@/components/admin/my-account-page"

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  updateOwnProfile: vi.fn(),
}))

import * as adminApi from "@/lib/api/admin"

const mockGetMe = vi.mocked(adminApi.getMe)
const mockUpdate = vi.mocked(adminApi.updateOwnProfile)

const ME = {
  id: "019f19ad-4fb3-766a-b2dd-ca3ea89f81dd",
  email: "ada@handshake.local",
  displayName: "Ada",
  role: { id: "role-1", name: "Super Admin" },
  status: "active" as const,
  mfaEnabled: true,
  permissions: [],
  menus: [],
  pages: [],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MyAccountPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetMe.mockReset().mockResolvedValue(ME)
  mockUpdate
    .mockReset()
    .mockResolvedValue({ ...ME, displayName: "Ada Lovelace" })
})

describe("MyAccountPage", () => {
  it("renders the operator identity read-only and seeds the editable name", async () => {
    renderPage()

    expect(await screen.findByDisplayValue("Ada")).toBeInTheDocument()
    expect(screen.getByText("ada@handshake.local")).toBeInTheDocument()
    expect(screen.getByText("Super Admin")).toBeInTheDocument()
    // 2FA enrolled shows as read-only text (managed via the MFA-enroll flow).
    expect(screen.getByText("Enrolled")).toBeInTheDocument()
  })

  it("saves a new display name through updateOwnProfile", async () => {
    const user = userEvent.setup()
    renderPage()

    const input = await screen.findByLabelText("Display name")
    await user.clear(input)
    await user.type(input, "Ada Lovelace")
    await user.click(screen.getByRole("button", { name: /Save changes/ }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({ displayName: "Ada Lovelace" })
    )
  })

  it("keeps Save disabled until the name is edited", async () => {
    renderPage()
    // Wait for the form to mount with the seeded value.
    await screen.findByDisplayValue("Ada")
    expect(screen.getByRole("button", { name: /Save changes/ })).toBeDisabled()
  })
})
