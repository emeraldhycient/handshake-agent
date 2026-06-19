import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FocusTrap } from "./focus-trap"

describe("FocusTrap", () => {
  it("renders children", () => {
    render(<FocusTrap ariaLabel="Test dialog">child content</FocusTrap>)
    expect(screen.getByText("child content")).toBeInTheDocument()
  })

  it("has role=dialog and aria-modal=true", () => {
    render(<FocusTrap ariaLabel="Enter your PIN">contents</FocusTrap>)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveAttribute("aria-label", "Enter your PIN")
  })

  it("accepts a custom className", () => {
    render(
      <FocusTrap ariaLabel="Test" className="my-class">
        x
      </FocusTrap>
    )
    const dialog = screen.getByRole("dialog")
    expect(dialog.className).toContain("my-class")
  })
})
