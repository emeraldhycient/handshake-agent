import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { SignupSuccess } from "./signup-success"

describe("SignupSuccess", () => {
  it("announces the check-your-email confirmation politely", () => {
    render(<SignupSuccess />)
    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(status).toHaveTextContent(/check your email/i)
    expect(status).toHaveTextContent(/verification link/i)
  })

  it("omits the dev shortcut when no token is supplied", () => {
    render(<SignupSuccess />)
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByText(/dev only/i)).toBeNull()
  })

  it("links to the verify-email route with the dev token when present", () => {
    render(<SignupSuccess devToken="tok-123" />)
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/verify-email?token=tok-123"
    )
  })

  it("labels the dev shortcut as dev-only so it is never mistaken for the real flow", () => {
    render(<SignupSuccess devToken="tok-123" />)
    expect(screen.getByText(/dev only/i)).toBeInTheDocument()
  })
})
