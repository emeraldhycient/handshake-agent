import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const profileQuery = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
const updateMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock("@/lib/query/auth", () => ({
  useProfile: () => profileQuery.current,
}))
vi.mock("@/lib/query/hooks", () => ({
  useConfig: () => ({
    data: {
      fiats: [
        { code: "NGN", displayName: "Nigerian Naira", symbol: "₦", decimals: 2 },
        { code: "GHS", displayName: "Ghanaian Cedi", symbol: "GH₵", decimals: 2 },
      ],
    },
  }),
}))
vi.mock("@/lib/query/profile", () => ({
  useUpdateProfile: () => updateMutation.current,
}))

import { ProfileSection } from "./profile-section"

const profileData = {
  email: "user@example.com",
  fullName: "Ada Tester",
  phone: "+2348012345678",
  kycStatus: "verified",
  kycTier: "tier_1",
  fiatCurrency: "NGN",
  limits: null,
}

describe("ProfileSection", () => {
  beforeEach(() => {
    profileQuery.current = { isLoading: false, isError: false, data: profileData }
    updateMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue(profileData),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    }
  })

  it("renders a skeleton while loading", () => {
    profileQuery.current = { isLoading: true, isError: false, data: undefined }
    const { container } = render(<ProfileSection />)
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })

  it("renders the error branch when the profile fails", () => {
    profileQuery.current = { isLoading: false, isError: true, data: undefined }
    render(<ProfileSection />)
    expect(screen.getByText(/could not load your profile/i)).toBeInTheDocument()
  })

  it("renders name, phone and the KYC badge", () => {
    render(<ProfileSection />)
    expect(screen.getByText("Ada Tester")).toBeInTheDocument()
    expect(screen.getByText("+2348012345678")).toBeInTheDocument()
    expect(screen.getByText(/verified · tier 1/i)).toBeInTheDocument()
  })

  it("opens the edit dialog and PATCHes only the changed field", async () => {
    const user = userEvent.setup()
    render(<ProfileSection />)

    await user.click(screen.getByRole("button", { name: /edit profile/i }))
    await user.selectOptions(
      screen.getByLabelText(/display currency/i),
      "GHS"
    )
    await user.click(screen.getByRole("button", { name: /save changes/i }))

    expect(
      (updateMutation.current.mutateAsync as ReturnType<typeof vi.fn>).mock
        .calls[0][0]
    ).toEqual({ fiatCurrency: "GHS" })
  })

  it("shows a phone validation error before any request fires", async () => {
    const user = userEvent.setup()
    render(<ProfileSection />)

    await user.click(screen.getByRole("button", { name: /edit profile/i }))
    const phone = screen.getByLabelText(/phone number/i)
    await user.clear(phone)
    await user.type(phone, "abc")
    await user.click(screen.getByRole("button", { name: /save changes/i }))

    expect(
      await screen.findByText(/enter a valid phone number/i)
    ).toBeInTheDocument()
    expect(updateMutation.current.mutateAsync).not.toHaveBeenCalled()
  })
})
