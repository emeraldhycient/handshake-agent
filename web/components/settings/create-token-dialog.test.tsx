import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ApiError } from "@/lib/api/client"
import { PIN_ERROR_COPY, TOKEN_SHOWN_ONCE_NOTE } from "@/constants/settings"

// jsdom has no ResizeObserver; the Radix Switch measures its thumb with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as typeof ResizeObserver

const createMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock("@/lib/query/profile", () => ({
  useCreatePat: () => createMutation.current,
}))

import { CreateTokenDialog } from "./create-token-dialog"

const created = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  label: "Claude",
  scopes: ["read", "chat:propose"],
  token: `hsk_pat_${"a".repeat(64)}`,
  createdAt: "2026-07-08T10:00:00.000Z",
  expiresAt: null,
}

describe("CreateTokenDialog", () => {
  beforeEach(() => {
    createMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue(created),
      isPending: false,
      reset: vi.fn(),
    }
  })

  it("defaults both scopes ON and expiry to never", async () => {
    const user = userEvent.setup()
    render(<CreateTokenDialog open onOpenChange={() => {}} />)

    expect(screen.getByRole("switch", { name: /read account data/i })).toBeChecked()
    expect(
      screen.getByRole("switch", { name: /propose transactions via chat/i })
    ).toBeChecked()

    await user.type(screen.getByLabelText(/token name/i), "Claude")
    await user.type(screen.getByLabelText(/transaction pin/i), "1234")
    await user.click(screen.getByRole("button", { name: /create token/i }))

    expect(createMutation.current.mutateAsync).toHaveBeenCalledWith({
      label: "Claude",
      pin: "1234",
      scopes: ["read", "chat:propose"],
    })
  })

  it("maps a day expiry to expiresInDays", async () => {
    const user = userEvent.setup()
    render(<CreateTokenDialog open onOpenChange={() => {}} />)

    await user.type(screen.getByLabelText(/token name/i), "Claude")
    await user.selectOptions(screen.getByLabelText(/expires/i), "90")
    await user.type(screen.getByLabelText(/transaction pin/i), "1234")
    await user.click(screen.getByRole("button", { name: /create token/i }))

    expect(
      (createMutation.current.mutateAsync as ReturnType<typeof vi.fn>).mock
        .calls[0][0]
    ).toMatchObject({ expiresInDays: 90 })
  })

  it("requires at least one scope", async () => {
    const user = userEvent.setup()
    render(<CreateTokenDialog open onOpenChange={() => {}} />)

    await user.click(screen.getByRole("switch", { name: /read account data/i }))
    await user.click(
      screen.getByRole("switch", { name: /propose transactions via chat/i })
    )
    await user.type(screen.getByLabelText(/token name/i), "Claude")
    await user.type(screen.getByLabelText(/transaction pin/i), "1234")
    await user.click(screen.getByRole("button", { name: /create token/i }))

    expect(
      await screen.findByText(/select at least one permission/i)
    ).toBeInTheDocument()
    expect(createMutation.current.mutateAsync).not.toHaveBeenCalled()
  })

  it("shows the raw token once with the shown-once warning and a copy control", async () => {
    const user = userEvent.setup()
    render(<CreateTokenDialog open onOpenChange={() => {}} />)

    await user.type(screen.getByLabelText(/token name/i), "Claude")
    await user.type(screen.getByLabelText(/transaction pin/i), "1234")
    await user.click(screen.getByRole("button", { name: /create token/i }))

    expect(await screen.findByText(created.token)).toBeInTheDocument()
    expect(screen.getByText(TOKEN_SHOWN_ONCE_NOTE)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /copy token/i })
    ).toBeInTheDocument()
    // The mint form is gone — the token cannot be minted twice from this state.
    expect(
      screen.queryByRole("button", { name: /create token/i })
    ).not.toBeInTheDocument()
  })

  it("maps PIN errors to distinct copy (lockout)", async () => {
    createMutation.current = {
      mutateAsync: vi
        .fn()
        .mockRejectedValue(new ApiError("locked", 401, "PIN_LOCKED")),
      isPending: false,
      reset: vi.fn(),
    }
    const user = userEvent.setup()
    render(<CreateTokenDialog open onOpenChange={() => {}} />)

    await user.type(screen.getByLabelText(/token name/i), "Claude")
    await user.type(screen.getByLabelText(/transaction pin/i), "1234")
    await user.click(screen.getByRole("button", { name: /create token/i }))

    expect(await screen.findByText(PIN_ERROR_COPY.locked)).toBeInTheDocument()
  })
})
