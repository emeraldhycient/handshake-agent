import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TypingIndicator } from "./typing-indicator"

describe("TypingIndicator", () => {
  it("renders data-testid='typing'", () => {
    render(<TypingIndicator />)
    expect(screen.getByTestId("typing")).toBeInTheDocument()
  })

  it("renders exactly 3 dot children", () => {
    render(<TypingIndicator />)
    const dots = screen.getByTestId("typing").querySelectorAll("span")
    expect(dots).toHaveLength(3)
  })

  it("has role='status' for live-region accessibility", () => {
    render(<TypingIndicator />)
    expect(screen.getByRole("status")).toBeInTheDocument()
  })
})
