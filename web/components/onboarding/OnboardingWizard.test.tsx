import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { MeResponse } from "@handshake-agent/contracts/auth"

// ─── Module mocks ─────────────────────────────────────────────────────────────
// Mirrors the mocking convention used by the individual step tests (e.g.
// OtpStep.test.tsx): mock the query/mutation hook modules and the viewport
// hook so the shell — and every step it composes — runs without a real
// QueryClientProvider or network access.

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

const isDesktop = vi.hoisted(() => ({ current: true as boolean | null }))
vi.mock("@/hooks/use-is-desktop", () => ({
  useIsDesktop: () => isDesktop.current,
}))

type MeShape = MeResponse | null | undefined
const me = vi.hoisted(() => ({ current: undefined as MeShape }))
const meLoading = vi.hoisted(() => ({ current: false }))
const signupRequestMutation = vi.hoisted(() => ({
  current: { mutateAsync: vi.fn(), isPending: false } as Record<
    string,
    unknown
  >,
}))
const signupVerifyMutation = vi.hoisted(() => ({
  current: { mutateAsync: vi.fn(), isPending: false } as Record<
    string,
    unknown
  >,
}))
vi.mock("@/lib/query/auth", () => ({
  useMe: () => ({ data: me.current, isLoading: meLoading.current }),
  useSignupRequest: () => signupRequestMutation.current,
  useSignupVerify: () => signupVerifyMutation.current,
}))

const setNameMutation = vi.hoisted(() => ({
  current: { mutateAsync: vi.fn(), isPending: false } as Record<
    string,
    unknown
  >,
}))
vi.mock("@/lib/query/kyc-onboarding", () => ({
  useSetName: () => setNameMutation.current,
}))

const setPinMutation = vi.hoisted(() => ({
  current: { mutateAsync: vi.fn(), isPending: false } as Record<
    string,
    unknown
  >,
}))
vi.mock("@/lib/query/kyc", () => ({
  useSetPin: () => setPinMutation.current,
}))

vi.mock("@/lib/device", () => ({
  getDeviceFingerprint: () => "web-test-fingerprint-0000",
}))

import { OnboardingWizard } from "./OnboardingWizard"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    email: "user@example.com",
    kycStatus: "not_started",
    kycTier: "tier_1",
    hasPin: false,
    emailVerified: true,
    firstName: "Ada",
    lastName: "Lovelace",
    ...overrides,
  }
}

function otpCells() {
  return screen.getAllByRole("textbox", { name: /digit/i })
}

function pinDots() {
  return document.querySelectorAll("[data-pin-dot]")
}

function filledPinDots() {
  return document.querySelectorAll('[data-pin-dot][data-state="filled"]')
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OnboardingWizard", () => {
  beforeEach(() => {
    push.mockClear()
    isDesktop.current = true
    me.current = undefined
    meLoading.current = false
  })

  it("shows a loading state while /me is still resolving", () => {
    meLoading.current = true
    render(<OnboardingWizard />)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /get started/i })
    ).not.toBeInTheDocument()
  })

  it("renders the desktop rail on a wide viewport", async () => {
    isDesktop.current = true
    me.current = null
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(screen.getByText(/256-bit encryption/i)).toBeInTheDocument()
    })
    // Welcome content still renders alongside the rail.
    expect(
      screen.getByRole("button", { name: /get started/i })
    ).toBeInTheDocument()
  })

  it("does not render the desktop rail on a narrow viewport", async () => {
    isDesktop.current = false
    me.current = null
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /get started/i })
      ).toBeInTheDocument()
    })
    expect(screen.queryByText(/256-bit encryption/i)).not.toBeInTheDocument()
  })

  it("renders OnboardingProgress and the Keypad on the mobile otp step", async () => {
    isDesktop.current = false
    me.current = makeMe({ emailVerified: false })
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(otpCells()).toHaveLength(6)
    })
    expect(
      screen.getByRole("progressbar", { name: /onboarding progress/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "7" })).toBeInTheDocument()
    expect(
      screen.getByRole("group", { name: /numeric keypad/i })
    ).toBeInTheDocument()
  })

  it("resumes a session with emailVerified+firstName+no-pin at the pin step", async () => {
    me.current = makeMe({
      emailVerified: true,
      firstName: "Ada",
      hasPin: false,
    })
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /set your transaction pin/i })
      ).toBeInTheDocument()
    })
  })

  it("resumes a null (no-session) visitor at the welcome step", async () => {
    me.current = null
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /get started/i })
      ).toBeInTheDocument()
    })
    expect(screen.getByRole("link", { name: /log in/i })).toBeInTheDocument()
  })

  it("resumes an already tier_2-verified session at the done step", async () => {
    me.current = makeMe({
      hasPin: true,
      kycTier: "tier_2",
      kycStatus: "verified",
    })
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /open my wallet/i })
      ).toBeInTheDocument()
    })
  })

  it("a mobile keypad tap on the otp step appends a digit to the shown code", async () => {
    const user = userEvent.setup()
    isDesktop.current = false
    me.current = makeMe({ emailVerified: false })
    render(<OnboardingWizard />)

    await waitFor(() => expect(otpCells()).toHaveLength(6))

    await user.click(screen.getByRole("button", { name: "5" }))

    expect(otpCells()[0]).toHaveValue("5")

    await user.click(screen.getByRole("button", { name: "2" }))
    expect(otpCells()[1]).toHaveValue("2")
  })

  it("keypad backspace trims the last digit of the shown code", async () => {
    const user = userEvent.setup()
    isDesktop.current = false
    me.current = makeMe({ emailVerified: false })
    render(<OnboardingWizard />)

    await waitFor(() => expect(otpCells()).toHaveLength(6))
    await user.click(screen.getByRole("button", { name: "5" }))
    expect(otpCells()[0]).toHaveValue("5")

    await user.click(screen.getByRole("button", { name: /backspace/i }))
    expect(otpCells()[0]).toHaveValue("")
  })

  it("renders the mobile pin step as keypad-driven dots, not masked inputs", async () => {
    isDesktop.current = false
    me.current = makeMe({
      emailVerified: true,
      firstName: "Ada",
      hasPin: false,
    })
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /create a transaction pin/i })
      ).toBeInTheDocument()
    })
    expect(
      screen.getByRole("group", { name: /numeric keypad/i })
    ).toBeInTheDocument()
    expect(pinDots()).toHaveLength(4)
    expect(screen.queryByLabelText(/^create pin/i)).not.toBeInTheDocument()
  })

  it("mobile keypad taps fill the create screen then advance to the confirm screen", async () => {
    const user = userEvent.setup()
    isDesktop.current = false
    me.current = makeMe({
      emailVerified: true,
      firstName: "Ada",
      hasPin: false,
    })
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /create a transaction pin/i })
      ).toBeInTheDocument()
    })

    for (const digit of ["2", "4", "6", "8"]) {
      await user.click(screen.getByRole("button", { name: digit }))
    }

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /confirm your pin/i })
      ).toBeInTheDocument()
    })
    expect(filledPinDots()).toHaveLength(0)
  })

  it("a mismatched mobile confirm shows the mismatch message and clears", async () => {
    const user = userEvent.setup()
    isDesktop.current = false
    me.current = makeMe({
      emailVerified: true,
      firstName: "Ada",
      hasPin: false,
    })
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /create a transaction pin/i })
      ).toBeInTheDocument()
    })
    for (const digit of ["2", "4", "6", "8"]) {
      await user.click(screen.getByRole("button", { name: digit }))
    }
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /confirm your pin/i })
      ).toBeInTheDocument()
    })
    for (const digit of ["1", "1", "1", "1"]) {
      await user.click(screen.getByRole("button", { name: digit }))
    }

    expect(
      await screen.findByText(/don't match — try again/i)
    ).toBeInTheDocument()
    expect(filledPinDots()).toHaveLength(0)
    expect(setPinMutation.current.mutateAsync).not.toHaveBeenCalled()
  })

  it("a matching mobile confirm calls the set-pin hook and advances past the pin step", async () => {
    setPinMutation.current.mutateAsync = vi
      .fn()
      .mockResolvedValue({ hasPin: true })
    const user = userEvent.setup()
    isDesktop.current = false
    me.current = makeMe({
      emailVerified: true,
      firstName: "Ada",
      hasPin: false,
    })
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /create a transaction pin/i })
      ).toBeInTheDocument()
    })
    for (const digit of ["2", "4", "6", "8"]) {
      await user.click(screen.getByRole("button", { name: digit }))
    }
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /confirm your pin/i })
      ).toBeInTheDocument()
    })
    for (const digit of ["2", "4", "6", "8"]) {
      await user.click(screen.getByRole("button", { name: digit }))
    }

    await waitFor(() => {
      expect(setPinMutation.current.mutateAsync).toHaveBeenCalledWith("2468")
    })
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /verify now/i })
      ).toBeInTheDocument()
    })
  })

  it("wires the kyc-choice 'verify now' branch to the sumsub stub", async () => {
    const user = userEvent.setup()
    me.current = makeMe({ hasPin: true, kycTier: "tier_1" })
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /verify now/i })
      ).toBeInTheDocument()
    })
    await user.click(screen.getByRole("button", { name: /verify now/i }))

    expect(screen.getByText(/loading verification/i)).toBeInTheDocument()
  })

  it("wires the kyc-choice 'explore later' branch to a skipped done step", async () => {
    const user = userEvent.setup()
    me.current = makeMe({
      hasPin: true,
      kycTier: "tier_1",
      kycStatus: "unverified",
    })
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /explore first, verify later/i })
      ).toBeInTheDocument()
    })
    await user.click(
      screen.getByRole("button", { name: /explore first, verify later/i })
    )

    expect(screen.getByText(/verify to unlock sending/i)).toBeInTheDocument()
  })
})
