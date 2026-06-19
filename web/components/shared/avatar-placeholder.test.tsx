import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AvatarPlaceholder } from "./avatar-placeholder"

describe("AvatarPlaceholder", () => {
  it("renders with data-testid", () => {
    render(<AvatarPlaceholder />)
    expect(screen.getByTestId("avatar-placeholder")).toBeInTheDocument()
  })

  it("applies the default size (38px)", () => {
    render(<AvatarPlaceholder />)
    const el = screen.getByTestId("avatar-placeholder")
    expect(el).toHaveStyle({ width: "38px", height: "38px" })
  })

  it("applies a custom size", () => {
    render(<AvatarPlaceholder size={48} />)
    const el = screen.getByTestId("avatar-placeholder")
    expect(el).toHaveStyle({ width: "48px", height: "48px" })
  })

  it("uses CSS vars — no hex in backgroundImage", () => {
    render(<AvatarPlaceholder />)
    const el = screen.getByTestId("avatar-placeholder")
    const bg = (el as HTMLElement).style.backgroundImage
    expect(bg).toContain("var(--primary-mid)")
    expect(bg).toContain("var(--primary)")
    expect(bg).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  it("forwards className", () => {
    render(<AvatarPlaceholder className="extra-class" />)
    expect(screen.getByTestId("avatar-placeholder")).toHaveClass("extra-class")
  })
})
