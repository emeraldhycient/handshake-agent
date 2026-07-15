import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AccountSection } from "./account-section"

const profile = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const nicknames = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const createNick = vi.hoisted(() => ({
  current: {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  },
}))
const deleteNick = vi.hoisted(() => ({
  current: {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  },
}))
const changePayId = vi.hoisted(() => ({
  current: {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  },
}))
const showToast = vi.hoisted(() => vi.fn())

vi.mock("@/lib/query/auth", () => ({ useProfile: () => profile.current }))
vi.mock("@/lib/query/hooks", () => ({
  useConfig: () => ({ data: { fiats: [] } }),
}))
vi.mock("@/lib/query/profile", () => ({
  usePublicNicknames: () => nicknames.current,
  useCreatePublicNickname: () => createNick.current,
  useDeletePublicNickname: () => deleteNick.current,
  useChangePayId: () => changePayId.current,
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ showToast }) }))
vi.mock("./edit-profile-dialog", () => ({
  EditProfileDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="edit-dialog" /> : null,
}))

beforeEach(() => {
  showToast.mockClear()
  createNick.current = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }
  deleteNick.current = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }
  changePayId.current = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }
  profile.current = {
    data: {
      fullName: "olivia lee",
      email: "olivia@example.com",
      phone: "+2348100000007",
      kycTier: "tier_2",
      kycStatus: "verified",
      fiatCurrency: "NGN",
      payId: undefined,
      limits: null,
      memberSince: null,
      security: { score: 2, label: "fair" },
    },
  }
  nicknames.current = { data: { nicknames: [{ id: "n1", alias: "oli" }] } }
})

describe("AccountSection", () => {
  it("renders Name + Email and opens the edit dialog", async () => {
    render(<AccountSection density="desktop" />)
    expect(screen.getByText("Name")).toBeInTheDocument()
    expect(screen.getByText("olivia lee")).toBeInTheDocument()
    expect(screen.getByText("olivia@example.com")).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole("button", { name: "Edit" })[0])
    expect(screen.getByTestId("edit-dialog")).toBeInTheDocument()
  })

  it("shows the PayID claim affordance when unclaimed", () => {
    render(<AccountSection density="desktop" />)
    expect(screen.getByText(/Not yet claimed/i)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Claim handle" })
    ).toBeInTheDocument()
  })

  it("renders a nickname chip and removes it with a toast", async () => {
    render(<AccountSection density="desktop" />)
    expect(screen.getByText("@oli")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Remove @oli" }))
    expect(deleteNick.current.mutateAsync).toHaveBeenCalledWith("n1")
    expect(showToast).toHaveBeenCalledWith("Removed @oli")
  })

  it("adds a nickname through the inline handle input", async () => {
    render(<AccountSection density="desktop" />)
    await userEvent.click(screen.getByRole("button", { name: "Add nickname" }))
    await userEvent.type(
      screen.getByRole("textbox", { name: "Handle" }),
      "newnick"
    )
    await userEvent.click(screen.getByRole("button", { name: "Add" }))
    expect(createNick.current.mutateAsync).toHaveBeenCalledWith({
      alias: "newnick",
    })
  })
})
