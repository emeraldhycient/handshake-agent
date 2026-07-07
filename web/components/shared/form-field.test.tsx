import { render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it } from "vitest"
import { FormField } from "./form-field"

describe("FormField", () => {
  it("associates the label with the input (accessible name)", () => {
    render(<FormField id="email" label="Email address" />)
    expect(
      screen.getByRole("textbox", { name: /email address/i })
    ).toBeInTheDocument()
  })

  it("renders the error, marks the input invalid, and links them", () => {
    render(<FormField id="email" label="Email" error="Bad email" />)
    const input = screen.getByRole("textbox")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveAttribute("aria-describedby", "email-error")
    expect(screen.getByRole("alert")).toHaveTextContent("Bad email")
  })

  it("has no error affordance when valid", () => {
    render(<FormField id="email" label="Email" />)
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "false")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("forwards the ref to the underlying input (register-spread compatible)", () => {
    const ref = createRef<HTMLInputElement>()
    render(<FormField id="email" label="Email" ref={ref} />)
    expect(ref.current).toBe(screen.getByRole("textbox"))
  })
})
