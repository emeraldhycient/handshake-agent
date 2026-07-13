import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const setNameMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock("@/lib/query/kyc-onboarding", () => ({
  useSetName: () => setNameMutation.current,
}))

import { NameStep } from "./NameStep"

describe("NameStep", () => {
  beforeEach(() => {
    setNameMutation.current = {
      mutateAsync: vi
        .fn()
        .mockResolvedValue({ firstName: "Ada", lastName: "Lovelace" }),
      isPending: false,
    }
  })

  it("keeps Continue disabled until at least 2 characters are entered", async () => {
    const user = userEvent.setup()
    render(
      <NameStep data={{}} setData={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} />
    )

    const submit = screen.getByRole("button", { name: /continue/i })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText(/full name/i), "A")
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText(/full name/i), "da")
    expect(submit).toBeEnabled()
  })

  it("splits the full name, saves it, and advances", async () => {
    const user = userEvent.setup()
    const setData = vi.fn()
    const onNext = vi.fn()
    render(
      <NameStep data={{}} setData={setData} onNext={onNext} onBack={vi.fn()} />
    )

    await user.type(screen.getByLabelText(/full name/i), "Ada Lovelace")
    await user.click(screen.getByRole("button", { name: /continue/i }))

    expect(setNameMutation.current.mutateAsync).toHaveBeenCalledWith({
      firstName: "Ada",
      lastName: "Lovelace",
    })
    expect(setData).toHaveBeenCalledWith({
      firstName: "Ada",
      lastName: "Lovelace",
    })
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it("falls back to duplicating a single-word name for lastName", async () => {
    setNameMutation.current.mutateAsync = vi
      .fn()
      .mockResolvedValue({ firstName: "Cher", lastName: "Cher" })
    const user = userEvent.setup()
    render(
      <NameStep data={{}} setData={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} />
    )

    await user.type(screen.getByLabelText(/full name/i), "Cher")
    await user.click(screen.getByRole("button", { name: /continue/i }))

    expect(setNameMutation.current.mutateAsync).toHaveBeenCalledWith({
      firstName: "Cher",
      lastName: "Cher",
    })
  })

  it("surfaces a server error inline and does not advance", async () => {
    setNameMutation.current.mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("Name rejected"))
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(
      <NameStep data={{}} setData={vi.fn()} onNext={onNext} onBack={vi.fn()} />
    )

    await user.type(screen.getByLabelText(/full name/i), "Ada Lovelace")
    await user.click(screen.getByRole("button", { name: /continue/i }))

    expect(await screen.findByText(/name rejected/i)).toBeInTheDocument()
    expect(onNext).not.toHaveBeenCalled()
  })

  it("calls onBack when Back is clicked", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <NameStep data={{}} setData={vi.fn()} onNext={vi.fn()} onBack={onBack} />
    )
    await user.click(screen.getByRole("button", { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
