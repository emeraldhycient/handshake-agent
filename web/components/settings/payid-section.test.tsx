import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ApiError } from "@/lib/api/client"

const profileQuery = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
const changePayIdMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock("@/lib/query/auth", () => ({
  useProfile: () => profileQuery.current,
}))
vi.mock("@/lib/query/profile", () => ({
  useChangePayId: () => changePayIdMutation.current,
}))

// jsdom has no clipboard API by default.
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
})

import { PayIdSection } from "./payid-section"

describe("PayIdSection", () => {
  beforeEach(() => {
    profileQuery.current = {
      isLoading: false,
      isError: false,
      data: { payId: "adaonly" },
    }
    changePayIdMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      reset: vi.fn(),
    }
  })

  it("renders a skeleton while loading", () => {
    profileQuery.current = { isLoading: true, isError: false, data: undefined }
    const { container } = render(<PayIdSection />)
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })

  it("renders the error branch", () => {
    profileQuery.current = { isLoading: false, isError: true, data: undefined }
    render(<PayIdSection />)
    expect(screen.getByText(/could not load your payid/i)).toBeInTheDocument()
  })

  it("shows the user's @handle with a copy control", () => {
    render(<PayIdSection />)
    expect(screen.getByText("@adaonly")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /copy payid/i })
    ).toBeInTheDocument()
  })

  it("shows a 'not yet claimed' state when the profile has no payId", () => {
    profileQuery.current = {
      isLoading: false,
      isError: false,
      data: { payId: undefined },
    }
    render(<PayIdSection />)
    expect(screen.getByText(/not yet claimed/i)).toBeInTheDocument()
  })

  it("validates and submits a new handle", async () => {
    const user = userEvent.setup()
    render(<PayIdSection />)

    await user.click(screen.getByRole("button", { name: /change/i }))
    await user.type(screen.getByLabelText(/new handle/i), "NewHandle")
    await user.click(screen.getByRole("button", { name: /^save$/i }))

    expect(changePayIdMutation.current.mutateAsync).toHaveBeenCalledWith({
      payId: "newhandle",
    })
  })

  it("shows a validation error before any request fires for a malformed handle", async () => {
    const user = userEvent.setup()
    render(<PayIdSection />)

    await user.click(screen.getByRole("button", { name: /change/i }))
    await user.type(screen.getByLabelText(/new handle/i), "ab")
    await user.click(screen.getByRole("button", { name: /^save$/i }))

    expect(await screen.findByText(/3-30 chars/i)).toBeInTheDocument()
    expect(changePayIdMutation.current.mutateAsync).not.toHaveBeenCalled()
  })

  it("renders a non-lockout error inline and keeps the form open", async () => {
    changePayIdMutation.current = {
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
    render(<PayIdSection />)

    await user.click(screen.getByRole("button", { name: /change/i }))
    await user.type(screen.getByLabelText(/new handle/i), "taken")
    await user.click(screen.getByRole("button", { name: /^save$/i }))

    expect(await screen.findByText(/already taken/i)).toBeInTheDocument()
    // The form stays open — a taken handle is retryable, unlike the one-change lock.
    expect(screen.getByLabelText(/new handle/i)).toBeInTheDocument()
  })

  it("renders the inline 'already changed' message on a 409 and hides the change control", async () => {
    changePayIdMutation.current = {
      mutateAsync: vi
        .fn()
        .mockRejectedValue(
          new ApiError(
            "Your PayID has already been changed once and cannot be changed again.",
            409,
            "PAYID_ALREADY_CHANGED"
          )
        ),
      isPending: false,
      reset: vi.fn(),
    }
    const user = userEvent.setup()
    render(<PayIdSection />)

    await user.click(screen.getByRole("button", { name: /change/i }))
    await user.type(screen.getByLabelText(/new handle/i), "another")
    await user.click(screen.getByRole("button", { name: /^save$/i }))

    expect(
      await screen.findByText(/already been changed once/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /change/i })
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/new handle/i)).not.toBeInTheDocument()
  })
})
