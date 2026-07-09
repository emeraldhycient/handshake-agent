import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ApiError } from "@/lib/api/client"
import { PIN_ERROR_COPY } from "@/constants/settings"

const changePinMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock("@/lib/query/profile", () => ({
  useChangePin: () => changePinMutation.current,
}))

import { ChangePinDialog } from "./change-pin-dialog"

async function fillPins(
  user: ReturnType<typeof userEvent.setup>,
  current: string,
  next: string,
  confirm: string
) {
  await user.type(screen.getByLabelText(/current pin/i), current)
  await user.type(screen.getByLabelText(/^new pin/i), next)
  await user.type(screen.getByLabelText(/confirm new pin/i), confirm)
  await user.click(screen.getByRole("button", { name: /update pin/i }))
}

describe("ChangePinDialog", () => {
  beforeEach(() => {
    changePinMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      reset: vi.fn(),
    }
  })

  it("rejects a mismatched confirmation client-side", async () => {
    const user = userEvent.setup()
    render(<ChangePinDialog open onOpenChange={() => {}} />)

    await fillPins(user, "1234", "2468", "2469")

    expect(await screen.findByText(/pins do not match/i)).toBeInTheDocument()
    expect(changePinMutation.current.mutateAsync).not.toHaveBeenCalled()
  })

  it("rejects a weak new PIN client-side", async () => {
    const user = userEvent.setup()
    render(<ChangePinDialog open onOpenChange={() => {}} />)

    await fillPins(user, "1234", "1111", "1111")

    expect(
      await screen.findByText(/must not be all the same digit/i)
    ).toBeInTheDocument()
    expect(changePinMutation.current.mutateAsync).not.toHaveBeenCalled()
  })

  it("submits currentPin + newPin and shows the success state", async () => {
    const user = userEvent.setup()
    render(<ChangePinDialog open onOpenChange={() => {}} />)

    await fillPins(user, "1234", "2468", "2468")

    expect(changePinMutation.current.mutateAsync).toHaveBeenCalledWith({
      currentPin: "1234",
      newPin: "2468",
    })
    expect(await screen.findByText(/pin updated/i)).toBeInTheDocument()
  })

  it("shows the lockout copy on PIN_LOCKED", async () => {
    changePinMutation.current = {
      mutateAsync: vi
        .fn()
        .mockRejectedValue(new ApiError("locked", 401, "PIN_LOCKED")),
      isPending: false,
      reset: vi.fn(),
    }
    const user = userEvent.setup()
    render(<ChangePinDialog open onOpenChange={() => {}} />)

    await fillPins(user, "1234", "2468", "2468")

    expect(await screen.findByText(PIN_ERROR_COPY.locked)).toBeInTheDocument()
  })

  it("shows the wrong-PIN copy on a 401 PIN_INVALID", async () => {
    changePinMutation.current = {
      mutateAsync: vi
        .fn()
        .mockRejectedValue(
          new ApiError("Authorization failed.", 401, "PIN_INVALID")
        ),
      isPending: false,
      reset: vi.fn(),
    }
    const user = userEvent.setup()
    render(<ChangePinDialog open onOpenChange={() => {}} />)

    await fillPins(user, "1234", "2468", "2468")

    expect(await screen.findByText(PIN_ERROR_COPY.wrongPin)).toBeInTheDocument()
  })
})
