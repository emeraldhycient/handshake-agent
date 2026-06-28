/**
 * TDD tests for LoginForm — written BEFORE the implementation.
 *
 * Tests:
 *  1. Step 1: renders email field + "Get OTP" button
 *  2. Step 1: blocks submit on invalid email
 *  3. Step 1: valid email → submitLoginRequest called; advances to step 2
 *  4. Step 2: with devOtp, shows devOtp helper text and prefills OTP
 *  5. Step 2: submit calls submitLoginVerify with { email, otp, deviceFingerprint }
 *  6. Step 2: success navigates to '/'
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { LoginForm } from "./LoginForm"

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/api/auth", () => ({
  submitSignup: vi.fn(),
  submitVerifyEmail: vi.fn(),
  submitLoginRequest: vi.fn(),
  submitLoginVerify: vi.fn(),
  refreshSession: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}))

vi.mock("@/lib/device", () => ({
  getDeviceFingerprint: vi.fn(() => "web-test-fingerprint-00000000"),
}))

const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}))

import { submitLoginRequest, submitLoginVerify } from "@/lib/api/auth"

const mockLoginRequest = vi.mocked(submitLoginRequest)
const mockLoginVerify = vi.mocked(submitLoginVerify)

// ─── Test helper ─────────────────────────────────────────────────────────────

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

const VALID_EMAIL = "user@example.com"
const VALID_OTP = "123456"

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LoginForm", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockPush.mockReset()
  })

  it("step 1: renders email field and Get OTP button", () => {
    renderForm()

    expect(screen.getByRole("textbox", { name: /email/i })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /get otp|send otp/i })
    ).toBeInTheDocument()
  })

  it("step 1: blocks submit on invalid email and does not call mutation", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      "notanemail"
    )

    await user.click(screen.getByRole("button", { name: /get otp|send otp/i }))

    expect(mockLoginRequest).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(document.getElementById("login-email-error")).toBeInTheDocument()
    })
  })

  it("step 1: valid email calls submitLoginRequest and advances to step 2", async () => {
    const user = userEvent.setup()
    mockLoginRequest.mockResolvedValueOnce({ status: "otp_sent" })
    renderForm()

    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      VALID_EMAIL
    )

    await user.click(screen.getByRole("button", { name: /get otp|send otp/i }))

    await waitFor(() => {
      expect(mockLoginRequest).toHaveBeenCalledWith({ email: VALID_EMAIL })
    })

    // Step 2 should now be visible — OTP field
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /otp|one.time/i })
      ).toBeInTheDocument()
    })
  })

  it("step 2: with devOtp shows dev helper text and prefills otp field", async () => {
    const user = userEvent.setup()
    const devOtp = "987654"
    mockLoginRequest.mockResolvedValueOnce({ status: "otp_sent", devOtp })
    renderForm()

    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      VALID_EMAIL
    )

    await user.click(screen.getByRole("button", { name: /get otp|send otp/i }))

    await waitFor(() => {
      expect(screen.getByText(new RegExp(devOtp))).toBeInTheDocument()
    })

    // OTP field should be prefilled
    const otpField = screen.getByRole("textbox", { name: /otp|one.time/i })
    expect(otpField).toHaveValue(devOtp)
  })

  it("step 2: submit calls submitLoginVerify with email, otp, and deviceFingerprint", async () => {
    const user = userEvent.setup()
    mockLoginRequest.mockResolvedValueOnce({ status: "otp_sent" })
    mockLoginVerify.mockResolvedValueOnce({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {
        userId: "11111111-1111-1111-1111-111111111111",
        email: VALID_EMAIL,
        kycStatus: "none",
        kycTier: "0",
        hasPin: false,
      },
    })
    renderForm()

    // Step 1
    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      VALID_EMAIL
    )
    await user.click(screen.getByRole("button", { name: /get otp|send otp/i }))

    // Step 2
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /otp|one.time/i })
      ).toBeInTheDocument()
    })

    const otpField = screen.getByRole("textbox", { name: /otp|one.time/i })
    await user.clear(otpField)
    await user.type(otpField, VALID_OTP)

    await user.click(
      screen.getByRole("button", { name: /verify|log in|sign in/i })
    )

    await waitFor(() => {
      expect(mockLoginVerify).toHaveBeenCalledWith({
        email: VALID_EMAIL,
        otp: VALID_OTP,
        deviceFingerprint: "web-test-fingerprint-00000000",
      })
    })
  })

  it("step 2: success navigates to '/'", async () => {
    const user = userEvent.setup()
    mockLoginRequest.mockResolvedValueOnce({ status: "otp_sent" })
    mockLoginVerify.mockResolvedValueOnce({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {
        userId: "11111111-1111-1111-1111-111111111111",
        email: VALID_EMAIL,
        kycStatus: "none",
        kycTier: "0",
        hasPin: false,
      },
    })
    renderForm()

    // Step 1
    await user.type(
      screen.getByRole("textbox", { name: /email/i }),
      VALID_EMAIL
    )
    await user.click(screen.getByRole("button", { name: /get otp|send otp/i }))

    // Step 2
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /otp|one.time/i })
      ).toBeInTheDocument()
    })

    await user.type(
      screen.getByRole("textbox", { name: /otp|one.time/i }),
      VALID_OTP
    )

    await user.click(
      screen.getByRole("button", { name: /verify|log in|sign in/i })
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/")
    })
  })
})
