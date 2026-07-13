import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const signupVerifyMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
const signupRequestMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock("@/lib/query/auth", () => ({
  useSignupVerify: () => signupVerifyMutation.current,
  useSignupRequest: () => signupRequestMutation.current,
}))
vi.mock("@/lib/device", () => ({
  getDeviceFingerprint: () => "web-test-fingerprint-0000",
}))

import { OtpStep } from "./OtpStep"

function otpCells() {
  return screen.getAllByRole("textbox", { name: /digit/i })
}

describe("OtpStep", () => {
  beforeEach(() => {
    signupVerifyMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue({
        accessToken: "t",
        refreshToken: "r",
        user: {
          userId: "u1",
          email: "a@b.com",
          kycStatus: "unverified",
          kycTier: "tier_1",
          hasPin: false,
        },
      }),
      isPending: false,
    }
    signupRequestMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue({ status: "otp_sent" }),
      isPending: false,
    }
  })

  it("renders 6 cells reflecting data.otp", () => {
    render(
      <OtpStep
        data={{ email: "a@b.com", otp: "123" }}
        setData={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    )
    const cells = otpCells()
    expect(cells).toHaveLength(6)
    expect(cells[0]).toHaveValue("1")
    expect(cells[1]).toHaveValue("2")
    expect(cells[2]).toHaveValue("3")
    expect(cells[3]).toHaveValue("")
  })

  it("typing a digit updates data via setData and advances focus", async () => {
    const user = userEvent.setup()
    const setData = vi.fn()
    render(
      <OtpStep
        data={{ email: "a@b.com", otp: "" }}
        setData={setData}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    )
    await user.type(otpCells()[0], "5")
    expect(setData).toHaveBeenCalledWith({ otp: "5" })
  })

  it("backspace on an empty cell clears and focuses the previous cell", async () => {
    const user = userEvent.setup()
    const setData = vi.fn()
    render(
      <OtpStep
        data={{ email: "a@b.com", otp: "12" }}
        setData={setData}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    )
    const cells = otpCells()
    cells[2].focus()
    await user.keyboard("{Backspace}")
    expect(setData).toHaveBeenCalledWith({ otp: "1" })
    expect(cells[1]).toHaveFocus()
  })

  it("auto-submits once 6 digits are present and advances on success", async () => {
    const user = userEvent.setup()
    const setData = vi.fn()
    const onNext = vi.fn()
    render(
      <OtpStep
        data={{ email: "a@b.com", otp: "12345" }}
        setData={setData}
        onNext={onNext}
        onBack={vi.fn()}
      />
    )
    await user.type(otpCells()[5], "6")

    expect(setData).toHaveBeenCalledWith({ otp: "123456" })
  })

  it("verifies and advances when data.otp already has 6 digits", async () => {
    const onNext = vi.fn()
    render(
      <OtpStep
        data={{ email: "a@b.com", otp: "123456" }}
        setData={vi.fn()}
        onNext={onNext}
        onBack={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(signupVerifyMutation.current.mutateAsync).toHaveBeenCalledWith({
        email: "a@b.com",
        otp: "123456",
        deviceFingerprint: "web-test-fingerprint-0000",
      })
    )
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1))
  })

  it("shows a server error inline when verification fails", async () => {
    signupVerifyMutation.current.mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("Invalid code"))
    render(
      <OtpStep
        data={{ email: "a@b.com", otp: "123456" }}
        setData={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    )
    expect(await screen.findByText(/invalid code/i)).toBeInTheDocument()
  })

  it("calls onBack when Back is clicked", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <OtpStep
        data={{ email: "a@b.com", otp: "" }}
        setData={vi.fn()}
        onNext={vi.fn()}
        onBack={onBack}
      />
    )
    await user.click(screen.getByRole("button", { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it("shows a dev-OTP hint when data.devOtp is present", () => {
    render(
      <OtpStep
        data={{ email: "a@b.com", otp: "", devOtp: "999999" }}
        setData={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    )
    expect(screen.getByText(/999999/)).toBeInTheDocument()
  })
})
