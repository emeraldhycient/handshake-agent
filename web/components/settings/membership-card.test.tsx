import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MembershipCard } from "./membership-card"

const profileRef = vi.hoisted(() => ({
  current: { data: undefined as unknown },
}))
const refreshIdentity = vi.hoisted(() => ({ current: vi.fn() }))

vi.mock("@/lib/query/auth", () => ({
  useProfile: () => profileRef.current,
}))
vi.mock("@/lib/query/kyc-onboarding", () => ({
  useRefreshIdentity: () => refreshIdentity.current,
}))
vi.mock("@/components/kyc/SumsubVerificationDialog", () => ({
  SumsubVerificationDialog: ({
    open,
    level,
  }: {
    open: boolean
    level: string
  }) => (open ? <div data-testid="sumsub-dialog">verify:{level}</div> : null),
}))

const baseProfile = {
  email: "olivia@example.com",
  fullName: "olivia lee",
  phone: "+2348100000007",
  kycStatus: "verified",
  kycTier: "tier_2",
  fiatCurrency: "NGN",
  limits: {
    perTxFiatMax: 500000,
    dailyFiatMax: 2000000,
    dailyTxCountMax: 20,
    dailyFiatUsed: 320000,
    dailyTxCountUsed: 3,
  },
  memberSince: "2026-07-01T00:00:00.000Z",
  security: { score: 3, label: "strong" },
}

beforeEach(() => {
  refreshIdentity.current = vi.fn()
  profileRef.current = { data: { ...baseProfile } }
})

describe("MembershipCard", () => {
  it("renders nothing until the profile has loaded", () => {
    profileRef.current = { data: undefined }
    const { container } = render(<MembershipCard density="desktop" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the masked phone, tier, formatted daily limit, and used amount", () => {
    render(<MembershipCard density="desktop" />)
    expect(screen.getByText("+234 810 •••• 0007")).toBeInTheDocument()
    expect(screen.getByText("olivia lee")).toBeInTheDocument()
    expect(screen.getByText(/2,000,000/)).toBeInTheDocument()
    expect(screen.getByText(/320,000.*used today/)).toBeInTheDocument()
    expect(screen.getByText("MEMBER SINCE JUL 2026")).toBeInTheDocument()
  })

  it("renders the security label and fills `score` of 4 bars", () => {
    const { container } = render(<MembershipCard density="desktop" />)
    expect(screen.getByText("strong")).toBeInTheDocument()
    const bars = container.querySelectorAll("div.h-\\[5px\\]")
    expect(bars).toHaveLength(4)
    const filled = Array.from(bars).filter((b) =>
      b.className.includes("bg-membership-mint")
    )
    expect(filled).toHaveLength(3)
  })

  it("shows a verify CTA below the top tier and opens the Sumsub dialog", async () => {
    profileRef.current = { data: { ...baseProfile, kycTier: "tier_2" } }
    render(<MembershipCard density="desktop" />)
    const cta = screen.getByRole("button", {
      name: /verify address to raise limits/i,
    })
    await userEvent.click(cta)
    expect(screen.getByTestId("sumsub-dialog")).toHaveTextContent(
      "verify:tier_3"
    )
  })

  it("hides the verify CTA at the top tier", () => {
    profileRef.current = { data: { ...baseProfile, kycTier: "tier_3" } }
    render(<MembershipCard density="desktop" />)
    expect(
      screen.queryByRole("button", { name: /verify/i })
    ).not.toBeInTheDocument()
  })
})
