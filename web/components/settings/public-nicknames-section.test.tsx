import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ApiError } from "@/lib/api/client"

const nicknamesQuery = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
const createMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
const removeMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock("@/lib/query/profile", () => ({
  usePublicNicknames: () => nicknamesQuery.current,
  useCreatePublicNickname: () => createMutation.current,
  useDeletePublicNickname: () => removeMutation.current,
}))

import { PublicNicknamesSection } from "./public-nicknames-section"

const nickname = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  alias: "adaonly2",
}

describe("PublicNicknamesSection", () => {
  beforeEach(() => {
    nicknamesQuery.current = {
      isLoading: false,
      isError: false,
      data: { nicknames: [nickname] },
    }
    createMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      reset: vi.fn(),
    }
    removeMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    }
  })

  it("renders a skeleton while loading", () => {
    nicknamesQuery.current = {
      isLoading: true,
      isError: false,
      data: undefined,
    }
    const { container } = render(<PublicNicknamesSection />)
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })

  it("renders the error branch", () => {
    nicknamesQuery.current = {
      isLoading: false,
      isError: true,
      data: undefined,
    }
    render(<PublicNicknamesSection />)
    expect(
      screen.getByText(/could not load your nicknames/i)
    ).toBeInTheDocument()
  })

  it("renders the empty branch", () => {
    nicknamesQuery.current = {
      isLoading: false,
      isError: false,
      data: { nicknames: [] },
    }
    render(<PublicNicknamesSection />)
    expect(screen.getByText(/no public nicknames yet/i)).toBeInTheDocument()
  })

  it("renders the alias list", () => {
    render(<PublicNicknamesSection />)
    expect(screen.getByText("@adaonly2")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: `Remove @${nickname.alias}` })
    ).toBeInTheDocument()
  })

  it("validates and submits a new alias", async () => {
    const user = userEvent.setup()
    render(<PublicNicknamesSection />)

    await user.click(screen.getByRole("button", { name: /add nickname/i }))
    await user.type(screen.getByLabelText(/new alias/i), "NewAlias")
    await user.click(screen.getByRole("button", { name: /^add$/i }))

    expect(createMutation.current.mutateAsync).toHaveBeenCalledWith({
      alias: "newalias",
    })
  })

  it("shows a validation error before any request fires for a malformed alias", async () => {
    const user = userEvent.setup()
    render(<PublicNicknamesSection />)

    await user.click(screen.getByRole("button", { name: /add nickname/i }))
    await user.type(screen.getByLabelText(/new alias/i), "ab")
    await user.click(screen.getByRole("button", { name: /^add$/i }))

    expect(await screen.findByText(/3-30 chars/i)).toBeInTheDocument()
    expect(createMutation.current.mutateAsync).not.toHaveBeenCalled()
  })

  it("renders a 409 taken-handle error inline and keeps the form open", async () => {
    createMutation.current = {
      mutateAsync: vi
        .fn()
        .mockRejectedValue(
          new ApiError(
            "That handle is already taken. Please choose another.",
            409,
            "HANDLE_TAKEN"
          )
        ),
      isPending: false,
      reset: vi.fn(),
    }
    const user = userEvent.setup()
    render(<PublicNicknamesSection />)

    await user.click(screen.getByRole("button", { name: /add nickname/i }))
    await user.type(screen.getByLabelText(/new alias/i), "taken")
    await user.click(screen.getByRole("button", { name: /^add$/i }))

    expect(await screen.findByText(/already taken/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/new alias/i)).toBeInTheDocument()
  })

  it("renders a 422 cap-exceeded error inline and keeps the form open", async () => {
    createMutation.current = {
      mutateAsync: vi
        .fn()
        .mockRejectedValue(
          new ApiError(
            "You have reached the maximum number of public nicknames.",
            422,
            "NICKNAME_CAP_EXCEEDED"
          )
        ),
      isPending: false,
      reset: vi.fn(),
    }
    const user = userEvent.setup()
    render(<PublicNicknamesSection />)

    await user.click(screen.getByRole("button", { name: /add nickname/i }))
    await user.type(screen.getByLabelText(/new alias/i), "onemore")
    await user.click(screen.getByRole("button", { name: /^add$/i }))

    expect(
      await screen.findByText(/maximum number of public nicknames/i)
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/new alias/i)).toBeInTheDocument()
  })

  it("removes a nickname after confirmation", async () => {
    const user = userEvent.setup()
    render(<PublicNicknamesSection />)

    await user.click(
      screen.getByRole("button", { name: `Remove @${nickname.alias}` })
    )
    await user.click(
      await screen.findByRole("button", { name: /yes, remove/i })
    )

    expect(removeMutation.current.mutateAsync).toHaveBeenCalledWith(nickname.id)
  })
})
