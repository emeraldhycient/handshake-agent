import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { OnboardingProgress } from "./OnboardingProgress"

function segmentStates(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll("[data-onboarding-segment]")
  ).map((el) => el.getAttribute("data-state"))
}

describe("OnboardingProgress", () => {
  it("renders a 4-segment progress bar", () => {
    const { container } = render(
      <OnboardingProgress step="email" onBack={vi.fn()} />
    )
    expect(
      container.querySelectorAll("[data-onboarding-segment]")
    ).toHaveLength(4)
  })

  it("marks all segments pending and none done at the first stage (email)", () => {
    const { container } = render(
      <OnboardingProgress step="email" onBack={vi.fn()} />
    )
    expect(segmentStates(container)).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
    ])
  })

  it("marks email+otp done, name active, pin pending at the name step", () => {
    const { container } = render(
      <OnboardingProgress step="name" onBack={vi.fn()} />
    )
    expect(segmentStates(container)).toEqual([
      "done",
      "done",
      "active",
      "pending",
    ])
  })

  it("marks every segment done once past the core stages (kyc)", () => {
    const { container } = render(
      <OnboardingProgress step="kyc" onBack={vi.fn()} />
    )
    expect(segmentStates(container)).toEqual(["done", "done", "done", "done"])
  })

  it("calls onBack when the back button is tapped", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<OnboardingProgress step="otp" onBack={onBack} />)

    await user.click(screen.getByRole("button", { name: /back/i }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
