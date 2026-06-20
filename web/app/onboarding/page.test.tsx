import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

// Mock next/navigation so useRouter works under Vitest (jsdom has no Next router).
const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}))

// Import after mock registration (Vitest hoists vi.mock, so this is safe).
import OnboardingPage from "./page"

describe("OnboardingPage (/onboarding)", () => {
  it("renders the KycSummary heading", () => {
    render(<OnboardingPage />)
    expect(
      screen.getByRole("heading", { name: /let's verify it's you/i })
    ).toBeInTheDocument()
  })

  it("routes to / when Finish button is clicked", async () => {
    pushMock.mockClear()
    const user = userEvent.setup()
    render(<OnboardingPage />)
    await user.click(
      screen.getByRole("button", { name: /finish & open my wallet/i })
    )
    expect(pushMock).toHaveBeenCalledWith("/")
  })
})
