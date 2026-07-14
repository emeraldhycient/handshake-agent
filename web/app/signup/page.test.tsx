/**
 * Tests for the legacy /signup route.
 *
 * Task F2.1: signup now lives inside the unified onboarding wizard at
 * /get-started (its `email` step). This route is a pure redirect kept only
 * so old links/bookmarks still resolve.
 */
import { redirect } from "next/navigation"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

import SignupPage from "./page"

describe("SignupPage (/signup)", () => {
  it("redirects to /get-started", () => {
    SignupPage()

    expect(redirect).toHaveBeenCalledWith("/get-started")
  })
})
