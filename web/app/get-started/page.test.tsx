/**
 * Tests for the /get-started route.
 *
 * The page is a thin orchestrator (root CLAUDE.md §16) — it renders
 * OnboardingWizard inside the `#main-content` landmark. OnboardingWizard
 * owns its own exhaustive test suite (OnboardingWizard.test.tsx); this test
 * only checks that the page wires it up, publicly (no auth guard).
 */
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/onboarding/OnboardingWizard", () => ({
  OnboardingWizard: () => <div data-testid="onboarding-wizard" />,
}))

import GetStartedPage from "./page"

describe("GetStartedPage (/get-started)", () => {
  it("renders the onboarding wizard inside the main landmark", () => {
    render(<GetStartedPage />)

    const main = screen.getByRole("main")
    expect(main).toHaveAttribute("id", "main-content")
    expect(screen.getByTestId("onboarding-wizard")).toBeInTheDocument()
  })
})
