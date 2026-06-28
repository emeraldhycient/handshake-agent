/**
 * TDD tests for SignupForm — written BEFORE the implementation.
 *
 * Tests:
 *  1. Renders email + phone fields and submit button
 *  2. Blocks submit on empty/invalid fields (mutation not called)
 *  3. Valid submit calls submitSignup with parsed email+phone
 *  4. Success without devToken shows "check your email" message only
 *  5. Success with devToken shows "check your email" + a link to /verify-email?token=<devToken>
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SignupForm } from "./SignupForm"

// ─── Module mock for the auth api client ─────────────────────────────────────

vi.mock("@/lib/api/auth", () => ({
  submitSignup: vi.fn(),
  submitVerifyEmail: vi.fn(),
  submitLoginRequest: vi.fn(),
  submitLoginVerify: vi.fn(),
  refreshSession: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}))

import { submitSignup } from "@/lib/api/auth"

const mockSubmitSignup = vi.mocked(submitSignup)

// ─── Test helper ─────────────────────────────────────────────────────────────

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SignupForm />
    </QueryClientProvider>
  )
}

const VALID_EMAIL = "test@example.com"
const VALID_PHONE = "+2348012345678"

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SignupForm", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("renders email + phone fields and submit button", () => {
    renderForm()

    expect(screen.getByRole("textbox", { name: /email/i })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /phone/i })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /create account|sign up/i })
    ).toBeInTheDocument()
  })

  it("blocks submit on empty/invalid fields and does not call mutation", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(
      screen.getByRole("button", { name: /create account|sign up/i })
    )

    expect(mockSubmitSignup).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(document.getElementById("signup-email-error")).toBeInTheDocument()
    })
  })

  it("calls submitSignup with parsed email and phone on valid submit", async () => {
    const user = userEvent.setup()
    mockSubmitSignup.mockResolvedValueOnce({ status: "pending_verification" })
    renderForm()

    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      VALID_EMAIL
    )
    await user.type(
      screen.getByRole("textbox", { name: /phone/i }),
      VALID_PHONE
    )

    await user.click(
      screen.getByRole("button", { name: /create account|sign up/i })
    )

    await waitFor(() => {
      expect(mockSubmitSignup).toHaveBeenCalledTimes(1)
    })

    const calledWith = mockSubmitSignup.mock.calls[0][0]
    expect(calledWith).toMatchObject({
      email: VALID_EMAIL,
      phone: VALID_PHONE,
    })
  })

  it("shows 'check your email' message on success without devToken", async () => {
    const user = userEvent.setup()
    mockSubmitSignup.mockResolvedValueOnce({ status: "pending_verification" })
    renderForm()

    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      VALID_EMAIL
    )
    await user.type(
      screen.getByRole("textbox", { name: /phone/i }),
      VALID_PHONE
    )

    await user.click(
      screen.getByRole("button", { name: /create account|sign up/i })
    )

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument()
    })

    // No dev link should be present
    expect(screen.queryByText(/dev.*verify/i)).not.toBeInTheDocument()
  })

  it("shows 'check your email' + dev link to /verify-email?token= when devToken is present", async () => {
    const user = userEvent.setup()
    const devToken = "dev-token-abc123"
    mockSubmitSignup.mockResolvedValueOnce({
      status: "pending_verification",
      devToken,
    })
    renderForm()

    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      VALID_EMAIL
    )
    await user.type(
      screen.getByRole("textbox", { name: /phone/i }),
      VALID_PHONE
    )

    await user.click(
      screen.getByRole("button", { name: /create account|sign up/i })
    )

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument()
    })

    const devLink = screen.getByRole("link", { name: /dev.*verify email/i })
    expect(devLink).toBeInTheDocument()
    expect(devLink).toHaveAttribute("href", `/verify-email?token=${devToken}`)
  })
})
