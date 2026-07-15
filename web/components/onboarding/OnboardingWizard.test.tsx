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

// The wizard gates its resume on the auth store leaving 'loading'. Derive a
// session state from the /me fixture so tests resolve the same way they intend:
// a null me = anonymous (no session), any me object (or undefined-while-loading)
// = authenticated. `authStatusOverride` lets a test pin 'loading' to exercise
// the rehydration window explicitly.
const authStatusOverride = vi.hoisted(() => ({
  current: null as null | string,
}))
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: (
    selector: (s: { status: string; accessToken: string | null }) => unknown
  ) => {
    const status =
      authStatusOverride.current ??
      (me.current === null ? "anonymous" : "authenticated")
    const accessToken = status === "anonymous" ? null : "test-access-token"
    return selector({ status, accessToken })
  },
}))

const setNameMutation = vi.hoisted(() => ({
  current: { mutateAsync: vi.fn(), isPending: false } as Record<
    string,
    unknown
  >,
}))
const sumsubTokenMutation = vi.hoisted(() => ({
  current: {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    data: undefined,
    isPending: true,
    isError: false,
    error: undefined,
    status: "idle",
  } as Record<string, unknown>,
}))
vi.mock("@/lib/query/kyc-onboarding", () => ({
  useSetName: () => setNameMutation.current,
  useSumsubToken: () => sumsubTokenMutation.current,
}))

// The real Sumsub WebSDK renders a remote iframe — stub it to a token echo plus
// a button that emits the applicant-submitted message the wizard listens for.
vi.mock("@sumsub/websdk-react", () => ({
  default: (props: {
    accessToken: string
    onMessage?: (type: string) => void
  }) => (
    <div data-testid="sumsub-sdk">
      <span data-testid="sdk-token">{props.accessToken}</span>
      <button
        type="button"
        onClick={() => props.onMessage?.("idCheck.onApplicantSubmitted")}
      >
        emit-submitted
      </button>
    </div>
  ),
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

// DoneStep resolves the platform default fiat from /config — stub it so the
// step renders without a real QueryClientProvider/network access.
const useConfig = vi.hoisted(() => vi.fn())
vi.mock("@/lib/query/hooks", () => ({ useConfig: () => useConfig() }))

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
    authStatusOverride.current = null
    sumsubTokenMutation.current = {
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      data: undefined,
      isPending: true,
      isError: false,
      error: undefined,
      status: "idle",
    }
    useConfig.mockReturnValue({
      data: {
        fiats: [
          { code: "NGN", displayName: "Naira", symbol: "₦", decimals: 2 },
        ],
      },
    })
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

  it("does NOT resume during auth rehydration (status 'loading'); resumes correctly once the session is authoritative", async () => {
    // Hard-reload scenario: the access token is still rehydrating from the
    // cookie, so the auth store is 'loading' and useMe is disabled (me undefined).
    authStatusOverride.current = "loading"
    me.current = makeMe({ hasPin: true, kycTier: "tier_1" })
    const { rerender } = render(<OnboardingWizard />)

    // Must show loading — NOT drop the returning user onto Welcome (the bug).
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /get started/i })
    ).not.toBeInTheDocument()

    // Cookie refresh resolves → authenticated; the resume now uses the real me
    // and lands on the KYC choice step (tier_1, verification not started).
    authStatusOverride.current = "authenticated"
    rerender(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /verify now/i })
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("button", { name: /get started/i })
    ).not.toBeInTheDocument()
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

  it("wires the kyc-choice 'verify now' branch to the Sumsub verification surface", async () => {
    const user = userEvent.setup()
    me.current = makeMe({ hasPin: true, kycTier: "tier_1" })
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /verify now/i })
      ).toBeInTheDocument()
    })
    await user.click(screen.getByRole("button", { name: /verify now/i }))

    // The token is still minting (mock defaults to isPending) — the loading branch.
    expect(screen.getByText(/preparing verification/i)).toBeInTheDocument()
    expect(sumsubTokenMutation.current.mutate).toHaveBeenCalledWith("tier_2")
  })

  it("moves to an in-review done step once the Sumsub flow is submitted", async () => {
    const user = userEvent.setup()
    me.current = makeMe({ hasPin: true, kycTier: "tier_1" })
    // Token already minted → the SDK stub renders.
    sumsubTokenMutation.current = {
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      data: { token: "sbx-token", userId: "u-1" },
      isPending: false,
      isError: false,
      error: undefined,
    }
    render(<OnboardingWizard />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /verify now/i })
      ).toBeInTheDocument()
    })
    await user.click(screen.getByRole("button", { name: /verify now/i }))

    // Applicant submits inside the SDK → wizard advances to the in-review done step.
    await user.click(screen.getByRole("button", { name: /emit-submitted/i }))

    await waitFor(() => {
      expect(screen.getByText(/in review/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/reviewing your verification/i)).toBeInTheDocument()
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
