/**
 * LoginForm tests.
 *
 *  1. A valid submit calls the (mocked) admin.login with the parsed body and
 *     navigates to '/' on success.
 *  2. A failed login renders the error branch with the server message.
 *
 * The api layer is mocked — no server, no real axios.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { LoginForm } from "@/components/admin/login-form"
import { ApiError } from "@/lib/api/client"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock("@/lib/api/admin", () => ({ login: vi.fn() }))

import { login } from "@/lib/api/admin"
const mockLogin = vi.mocked(login)

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <LoginForm />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockPush.mockReset()
  mockLogin.mockReset()
})

describe("LoginForm", () => {
  it("calls admin.login with the parsed body and navigates on success", async () => {
    mockLogin.mockResolvedValue({
      accessToken: "tok",
      expiresAt: new Date().toISOString(),
      admin: {
        id: "00000000-0000-0000-0000-000000000001",
        email: "admin@example.com",
        role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
        status: "active",
        displayName: "Test Admin",
        mfaEnabled: false,
        permissions: [],
        menus: [],
        pages: [],
      },
    })

    const user = userEvent.setup()
    renderForm()

    await user.type(
      screen.getByLabelText(/email address/i),
      "admin@example.com"
    )
    await user.type(screen.getByLabelText(/^password$/i), "supersecret")
    await user.click(screen.getByRole("button", { name: /sign in/i }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: "admin@example.com",
        password: "supersecret",
      })
    })
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"))
  })

  it("includes the TOTP once the MFA fields are revealed", async () => {
    mockLogin.mockResolvedValue({
      accessToken: "tok",
      expiresAt: new Date().toISOString(),
      admin: {
        id: "00000000-0000-0000-0000-000000000001",
        email: "admin@example.com",
        role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
        status: "active",
        displayName: "Test Admin",
        mfaEnabled: true,
        permissions: [],
        menus: [],
        pages: [],
      },
    })

    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(/email address/i), "admin@example.com")
    await user.type(screen.getByLabelText(/^password$/i), "supersecret")
    await user.click(screen.getByRole("button", { name: /use a multi-factor code/i }))
    await user.type(screen.getByLabelText(/authenticator code/i), "123456")
    await user.click(screen.getByRole("button", { name: /sign in/i }))

    await waitFor(() =>
      expect(mockLogin).toHaveBeenCalledWith({
        email: "admin@example.com",
        password: "supersecret",
        totp: "123456",
      })
    )
    // The empty recovery code must be stripped, not sent as "".
    expect(mockLogin.mock.calls[0][0]).not.toHaveProperty("recoveryCode")
  })

  it("renders the error branch on a failed login", async () => {
    mockLogin.mockRejectedValue(
      new ApiError("Invalid credentials.", 401, "ADMIN_INVALID_CREDENTIALS")
    )

    const user = userEvent.setup()
    renderForm()

    await user.type(
      screen.getByLabelText(/email address/i),
      "admin@example.com"
    )
    await user.type(screen.getByLabelText(/^password$/i), "wrongpass")
    await user.click(screen.getByRole("button", { name: /sign in/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid credentials."
    )
    expect(mockPush).not.toHaveBeenCalled()
  })
})
