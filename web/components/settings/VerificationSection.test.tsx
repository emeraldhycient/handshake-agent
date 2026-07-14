/**
 * TDD tests for VerificationSection — the Settings "verify / resume KYC" card.
 *
 * Shows the user's current tier and what the next rung unlocks, and launches
 * the Sumsub flow for that rung inline:
 *   tier_1 → tier_2 (document + liveness) unlocks send / sell / swap
 *   tier_2 → tier_3 (proof of address) raises limits
 *   tier_3 → fully verified, nothing to do
 *   kycStatus 'pending_review' → in-review, no CTA
 *
 * The tier is granted server-side off the Sumsub webhook (root §3.1); this card
 * only launches the flow and refreshes identity after submission.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const profileQuery = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
const refreshIdentity = vi.hoisted(() => vi.fn())
vi.mock("@/lib/query/auth", () => ({
  useProfile: () => profileQuery.current,
}))
vi.mock("@/lib/query/kyc-onboarding", () => ({
  useRefreshIdentity: () => refreshIdentity,
}))

// Stub the SDK surface so the section test stays focused on tier logic. Echoes
// the requested level and exposes a submit button.
const sdkLevel = vi.hoisted(() => ({ current: null as string | null }))
vi.mock("@/components/kyc/SumsubVerification", () => ({
  SumsubVerification: (props: { level: string; onSubmitted?: () => void }) => {
    sdkLevel.current = props.level
    return (
      <div data-testid="sumsub-surface">
        <span data-testid="sumsub-level">{props.level}</span>
        <button type="button" onClick={() => props.onSubmitted?.()}>
          emit-submitted
        </button>
      </div>
    )
  },
}))

import { VerificationSection } from "./VerificationSection"

function setProfile(overrides: Record<string, unknown>) {
  profileQuery.current = {
    data: {
      email: "user@example.com",
      kycStatus: "not_started",
      kycTier: "tier_1",
      ...overrides,
    },
  }
}

describe("VerificationSection", () => {
  beforeEach(() => {
    refreshIdentity.mockReset()
    sdkLevel.current = null
    setProfile({})
  })

  it("prompts a tier_1 user to verify to unlock sending", () => {
    setProfile({ kycTier: "tier_1", kycStatus: "not_started" })
    render(<VerificationSection />)
    expect(screen.getByText(/unlock sending/i)).toBeInTheDocument()
  })

  it("launches tier_2 (document + liveness) from the tier_1 CTA", async () => {
    setProfile({ kycTier: "tier_1", kycStatus: "not_started" })
    render(<VerificationSection />)

    await userEvent.click(screen.getByRole("button", { name: /verify/i }))
    expect(screen.getByTestId("sumsub-surface")).toBeInTheDocument()
    expect(screen.getByTestId("sumsub-level")).toHaveTextContent("tier_2")
  })

  it("prompts a tier_2 user to add a proof of address to raise limits", async () => {
    setProfile({ kycTier: "tier_2", kycStatus: "verified" })
    render(<VerificationSection />)
    expect(screen.getByText(/increase your limits/i)).toBeInTheDocument()
    expect(screen.getByText(/proof of address/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /verify|add/i }))
    expect(screen.getByTestId("sumsub-level")).toHaveTextContent("tier_3")
  })

  it("shows a fully-verified state at tier_3 with no CTA", () => {
    setProfile({ kycTier: "tier_3", kycStatus: "verified" })
    render(<VerificationSection />)
    expect(screen.getByText(/fully verified/i)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /verify|add/i })
    ).not.toBeInTheDocument()
  })

  it("shows an in-review state (no CTA) while a submission is pending", () => {
    setProfile({ kycTier: "tier_1", kycStatus: "pending_review" })
    render(<VerificationSection />)
    expect(screen.getByText(/verification in review/i)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /verify|add/i })
    ).not.toBeInTheDocument()
  })

  it("refreshes identity and shows in-review after the flow is submitted", async () => {
    setProfile({ kycTier: "tier_1", kycStatus: "not_started" })
    render(<VerificationSection />)

    await userEvent.click(screen.getByRole("button", { name: /verify/i }))
    await userEvent.click(
      screen.getByRole("button", { name: /emit-submitted/i })
    )

    expect(refreshIdentity).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/verification in review/i)).toBeInTheDocument()
  })
})
