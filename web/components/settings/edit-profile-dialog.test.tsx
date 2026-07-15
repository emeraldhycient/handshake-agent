import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { EditProfileDialog } from "./edit-profile-dialog"

const setName = vi.hoisted(() => ({
  current: {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
  },
}))
const update = vi.hoisted(() => ({
  current: {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
  },
}))

vi.mock("@/lib/query/auth", () => ({
  useMe: () => ({ data: { firstName: "Olivia", lastName: "Lee" } }),
}))
vi.mock("@/lib/query/profile", () => ({
  useUpdateProfile: () => update.current,
}))
vi.mock("@/lib/query/kyc-onboarding", () => ({
  useSetName: () => setName.current,
}))

function profile(kycTier: string) {
  return {
    email: "olivia@example.com",
    fullName: "Olivia Lee",
    phone: "+2348100000007",
    kycStatus: "verified",
    kycTier,
    fiatCurrency: "NGN",
    limits: null,
    memberSince: null,
    security: { score: 2, label: "fair" as const },
  }
}

beforeEach(() => {
  setName.current = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
  }
  update.current = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
  }
})

describe("EditProfileDialog", () => {
  it("lets a pre-KYC user edit their name and saves via the name endpoint", async () => {
    render(
      <EditProfileDialog
        open
        onOpenChange={() => {}}
        profile={profile("tier_1")}
      />
    )
    const first = screen.getByLabelText("First name")
    expect(first).not.toBeDisabled()
    await userEvent.clear(first)
    await userEvent.type(first, "Liv")
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(setName.current.mutateAsync).toHaveBeenCalledWith({
      firstName: "Liv",
      lastName: "Lee",
    })
  })

  it("locks the name fields once verified (tier_2) and does not call the name endpoint", async () => {
    render(
      <EditProfileDialog
        open
        onOpenChange={() => {}}
        profile={profile("tier_2")}
      />
    )
    expect(screen.getByLabelText("First name")).toBeDisabled()
    expect(screen.getByLabelText("Last name")).toBeDisabled()
    expect(
      screen.getByText(/name is locked after identity verification/i)
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(setName.current.mutateAsync).not.toHaveBeenCalled()
  })
})
