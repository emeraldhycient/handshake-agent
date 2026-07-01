import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { ActionButton } from "./action-button"

describe("ActionButton", () => {
  it("renders the label text", () => {
    render(<ActionButton label="Buy" onClick={() => {}} />)
    expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument()
  })

  it("uses the label as the accessible name even with an icon", () => {
    render(
      <ActionButton
        label="Send"
        icon={<span aria-hidden="true">↗</span>}
        onClick={() => {}}
      />
    )
    // The icon is aria-hidden; the accessible name comes from the label.
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument()
  })

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<ActionButton label="Swap" onClick={onClick} />)
    await user.click(screen.getByRole("button", { name: "Swap" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("exposes a focus-visible ring class for keyboard users (a11y)", () => {
    render(<ActionButton label="Receive" onClick={() => {}} />)
    const btn = screen.getByRole("button", { name: "Receive" })
    expect(btn.className).toMatch(/focus-visible:/)
  })

  it("applies distinct styling for primary vs secondary variants", () => {
    const { rerender } = render(
      <ActionButton label="Buy" variant="primary" onClick={() => {}} />
    )
    const primary = screen
      .getByRole("button", { name: "Buy" })
      .className.toString()
    rerender(
      <ActionButton label="Buy" variant="secondary" onClick={() => {}} />
    )
    const secondary = screen
      .getByRole("button", { name: "Buy" })
      .className.toString()
    expect(primary).not.toBe(secondary)
  })

  it("uses token classes only — no hex color literals", () => {
    render(<ActionButton label="Buy" variant="primary" onClick={() => {}} />)
    const cls = screen.getByRole("button", { name: "Buy" }).className
    expect(cls).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it("forwards a className", () => {
    render(<ActionButton label="Buy" onClick={() => {}} className="w-full" />)
    expect(screen.getByRole("button", { name: "Buy" })).toHaveClass("w-full")
  })

  it("renders a custom icon node", () => {
    render(
      <ActionButton
        label="Send"
        icon={<span data-testid="glyph">↗</span>}
        onClick={() => {}}
      />
    )
    expect(screen.getByTestId("glyph")).toBeInTheDocument()
  })

  it("supports a stacked layout for the mobile wallet tile", () => {
    render(
      <ActionButton
        label="Buy"
        icon={<span data-testid="glyph">+</span>}
        layout="stacked"
        onClick={() => {}}
      />
    )
    // Still a single accessible button with the label as its name.
    expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument()
    expect(screen.getByTestId("glyph")).toBeInTheDocument()
  })
})
