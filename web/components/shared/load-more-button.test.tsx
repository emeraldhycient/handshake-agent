import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { LoadMoreButton } from "./load-more-button"

describe("LoadMoreButton", () => {
  it("shows the label and fires onClick", async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <LoadMoreButton onClick={onClick} isPending={false} label="Load more" />
    )
    const btn = screen.getByRole("button", { name: "Load more" })
    await user.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("shows the pending label and is disabled while pending", () => {
    render(<LoadMoreButton onClick={() => {}} isPending label="Load more" />)
    const btn = screen.getByRole("button")
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent("Loading…")
  })

  it("uses a custom aria-label and passthrough className", () => {
    render(
      <LoadMoreButton
        onClick={() => {}}
        isPending={false}
        label="Show more (10 of 12)"
        ariaLabel="Show more transactions"
        className="w-full"
      />
    )
    const btn = screen.getByRole("button", { name: "Show more transactions" })
    expect(btn.className).toContain("w-full")
    expect(btn).toHaveTextContent("Show more (10 of 12)")
  })
})
