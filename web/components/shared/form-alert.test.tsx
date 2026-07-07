import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FormAlert } from "./form-alert"

describe("FormAlert", () => {
  it("renders an assertive alert with its message", () => {
    render(<FormAlert>Something went wrong</FormAlert>)
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Something went wrong")
    expect(alert).toHaveAttribute("aria-live", "assertive")
  })

  it("applies the danger tone by default and the warn tone when asked", () => {
    const { rerender } = render(<FormAlert>err</FormAlert>)
    expect(screen.getByRole("alert").className).toMatch(/destructive/)
    rerender(<FormAlert tone="warn">warn</FormAlert>)
    expect(screen.getByRole("alert").className).toMatch(/warn/)
  })
})
