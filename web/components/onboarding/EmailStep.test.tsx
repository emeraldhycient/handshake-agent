import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const signupRequestMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock("@/lib/query/auth", () => ({
  useSignupRequest: () => signupRequestMutation.current,
}))

import { EmailStep } from "./EmailStep"

describe("EmailStep", () => {
  beforeEach(() => {
    signupRequestMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue({ status: "otp_sent" }),
      isPending: false,
      error: null,
    }
  })

  it("keeps Send code disabled until a valid email is entered", async () => {
    const user = userEvent.setup()
    render(<EmailStep data={{}} setData={vi.fn()} onNext={vi.fn()} />)

    const submit = screen.getByRole("button", { name: /send code/i })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText(/email/i), "not-an-email")
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText(/email/i), "@example.com")
    expect(submit).toBeEnabled()
  })

  it("requests a code, stores email + devOtp, and advances on success", async () => {
    signupRequestMutation.current.mutateAsync = vi
      .fn()
      .mockResolvedValue({ status: "otp_sent", devOtp: "123456" })
    const user = userEvent.setup()
    const setData = vi.fn()
    const onNext = vi.fn()
    render(<EmailStep data={{}} setData={setData} onNext={onNext} />)

    await user.type(screen.getByLabelText(/email/i), "ada@example.com")
    await user.click(screen.getByRole("button", { name: /send code/i }))

    expect(signupRequestMutation.current.mutateAsync).toHaveBeenCalledWith(
      "ada@example.com"
    )
    expect(setData).toHaveBeenCalledWith({
      email: "ada@example.com",
      devOtp: "123456",
    })
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it("surfaces a server error inline and does not advance", async () => {
    signupRequestMutation.current.mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("Too many requests"))
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<EmailStep data={{}} setData={vi.fn()} onNext={onNext} />)

    await user.type(screen.getByLabelText(/email/i), "ada@example.com")
    await user.click(screen.getByRole("button", { name: /send code/i }))

    expect(await screen.findByText(/too many requests/i)).toBeInTheDocument()
    expect(onNext).not.toHaveBeenCalled()
  })

  it("prefills the email input from wizard data", () => {
    render(
      <EmailStep
        data={{ email: "resume@example.com" }}
        setData={vi.fn()}
        onNext={vi.fn()}
      />
    )
    expect(screen.getByLabelText(/email/i)).toHaveValue("resume@example.com")
  })

  it("renders Send code as the amber accent CTA", () => {
    render(<EmailStep data={{}} setData={vi.fn()} onNext={vi.fn()} />)

    expect(screen.getByRole("button", { name: /send code/i })).toHaveAttribute(
      "data-variant",
      "accent"
    )
  })
})
