/**
 * Tests for the legacy /onboarding route.
 *
 * Task F2.1: KYC onboarding now lives inside the unified onboarding wizard
 * at /get-started (which derives its own resume step from `useMe()`). This
 * route is a pure redirect kept only so old links/bookmarks still resolve.
 */
import { redirect } from "next/navigation"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

import OnboardingPage from "./page"

describe("OnboardingPage (/onboarding)", () => {
  it("redirects to /get-started", () => {
    OnboardingPage()

    expect(redirect).toHaveBeenCalledWith("/get-started")
  })
})
