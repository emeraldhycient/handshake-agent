/**
 * Structure test for AuthBrandRail — the static green brand rail that gives the
 * login shell parity with the onboarding wizard (Task F4.2). It has no logic;
 * we assert it renders the wordmark, the passed headline/subcopy, and the
 * encryption/compliance footer.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { AuthBrandRail } from "./AuthBrandRail"

describe("AuthBrandRail", () => {
  it("renders the wordmark, headline, subcopy and compliance footer", () => {
    render(
      <AuthBrandRail
        headline="Welcome back."
        subcopy="Log in to pick up where you left off."
      />
    )

    expect(screen.getByText("Handshake")).toBeInTheDocument()
    expect(screen.getByText("Welcome back.")).toBeInTheDocument()
    expect(
      screen.getByText(/log in to pick up where you left off/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/256-bit encryption/i)).toBeInTheDocument()
  })
})
