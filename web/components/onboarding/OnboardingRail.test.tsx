import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { OnboardingRail } from "./OnboardingRail"

function rowStates(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll("[data-onboarding-tracker-row]")
  ).map((el) => el.getAttribute("data-state"))
}

describe("OnboardingRail", () => {
  it("shows the headline and the encryption/compliance footer", () => {
    render(<OnboardingRail step="welcome" />)

    expect(
      screen.getByText(/money that moves at the speed of chat/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/256-bit encryption/i)).toBeInTheDocument()
  })

  it("renders the four tracker labels from the onboarding constants", () => {
    render(<OnboardingRail step="otp" />)

    expect(screen.getByText("Your email")).toBeInTheDocument()
    expect(screen.getByText("Verify email")).toBeInTheDocument()
    expect(screen.getByText("Your name")).toBeInTheDocument()
    expect(screen.getByText("Set PIN")).toBeInTheDocument()
  })

  it("marks all tracker rows pending at welcome", () => {
    const { container } = render(<OnboardingRail step="welcome" />)
    expect(rowStates(container)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ])
  })

  it("marks email active and the rest pending at the email step", () => {
    const { container } = render(<OnboardingRail step="email" />)
    expect(rowStates(container)).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
    ])
  })

  it("marks email+otp done, name active, pin pending at the name step", () => {
    const { container } = render(<OnboardingRail step="name" />)
    expect(rowStates(container)).toEqual(["done", "done", "active", "pending"])
  })

  it("marks every tracker row done once past the core stages (kyc/done)", () => {
    for (const step of ["kyc", "done"] as const) {
      const { container, unmount } = render(<OnboardingRail step={step} />)
      expect(rowStates(container)).toEqual(["done", "done", "done", "done"])
      unmount()
    }
  })
})
