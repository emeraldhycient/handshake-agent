/**
 * TDD tests for VerifyEmailForm — written to cover the button-click verify flow.
 *
 * Tests:
 *  1. Renders the verify button with the injected token prop
 *  2. Calls mutation with the token on button click
 *  3. Shows loading state while mutation is pending
 *  4. Shows success message after verified
 *  5. Shows error message on mutation failure
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { VerifyEmailForm } from "./VerifyEmailForm"

// ─── Module mock for the auth api client ─────────────────────────────────────

vi.mock("@/lib/api/auth", () => ({
  submitVerifyEmail: vi.fn(),
}))

import { submitVerifyEmail } from "@/lib/api/auth"

const mockSubmit = vi.mocked(submitVerifyEmail)

// ─── Test helper ─────────────────────────────────────────────────────────────

function renderForm(token: string) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <VerifyEmailForm token={token} />
    </QueryClientProvider>
  )
}

const VALID_TOKEN = "test-verify-token-abc123"

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("VerifyEmailForm", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("renders the verify button with the token prop", () => {
    renderForm(VALID_TOKEN)

    expect(
      screen.getByRole("button", { name: /verify email/i })
    ).toBeInTheDocument()
  })

  it("calls mutation with token on button click", async () => {
    const user = userEvent.setup()
    mockSubmit.mockResolvedValueOnce({ verified: true as const })
    renderForm(VALID_TOKEN)

    await user.click(screen.getByRole("button", { name: /verify email/i }))

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledTimes(1)
    })
    expect(mockSubmit).toHaveBeenCalledWith({ token: VALID_TOKEN })
  })

  it("shows loading state while mutation is pending", async () => {
    const user = userEvent.setup()
    // Never resolves during the test — keeps the button in pending state
    mockSubmit.mockImplementation(() => new Promise(() => {}))
    renderForm(VALID_TOKEN)

    await user.click(screen.getByRole("button", { name: /verify email/i }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /verifying/i })).toBeDisabled()
    })
  })

  it("shows success message after verified", async () => {
    const user = userEvent.setup()
    mockSubmit.mockResolvedValueOnce({ verified: true as const })
    renderForm(VALID_TOKEN)

    await user.click(screen.getByRole("button", { name: /verify email/i }))

    await waitFor(() => {
      expect(screen.getByText(/email verified/i)).toBeInTheDocument()
    })
    // Should also show a link back to /login
    expect(
      screen.getByRole("link", { name: /continue to login/i })
    ).toHaveAttribute("href", "/login")
  })

  it("shows error message on mutation failure", async () => {
    const user = userEvent.setup()
    mockSubmit.mockRejectedValueOnce(
      new Error("Token is invalid or has expired")
    )
    renderForm(VALID_TOKEN)

    await user.click(screen.getByRole("button", { name: /verify email/i }))

    await waitFor(() => {
      expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument()
    })
  })

  it("offers a 'resend verification email' affordance (not just 'sign up again') with reassuring copy", async () => {
    const user = userEvent.setup()
    mockSubmit.mockRejectedValueOnce(
      new Error("Token is invalid or has expired")
    )
    renderForm(VALID_TOKEN)

    await user.click(screen.getByRole("button", { name: /verify email/i }))

    // A clear resend affordance, pointing at the (idempotent) request-link path.
    const resendLink = await screen.findByRole("link", {
      name: /resend verification email|request a new link/i,
    })
    expect(resendLink).toHaveAttribute("href", "/signup")

    // Reassurance that resending does not create a duplicate account.
    expect(
      screen.getByText(/won'?t create a duplicate account/i)
    ).toBeInTheDocument()

    // The misleading "sign up again" wording must be gone.
    expect(screen.queryByText(/sign up again/i)).not.toBeInTheDocument()
  })
})
