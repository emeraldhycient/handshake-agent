import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import type { MeResponse } from "@handshake-agent/contracts/auth"
import {
  deriveResumeStep,
  useOnboardingMachine,
} from "./use-onboarding-machine"

function makeMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    email: "user@example.com",
    kycStatus: "not_started",
    kycTier: "tier_1",
    hasPin: false,
    emailVerified: true,
    firstName: "Ada",
    lastName: "Lovelace",
    ...overrides,
  }
}

describe("deriveResumeStep", () => {
  it("returns 'welcome' when there is no session", () => {
    expect(deriveResumeStep(null)).toBe("welcome")
  })

  it("returns 'otp' when the session's email is not yet verified", () => {
    const me = makeMe({ emailVerified: false })
    expect(deriveResumeStep(me)).toBe("otp")
  })

  it("returns 'otp' when emailVerified is omitted (defensive default)", () => {
    const me = makeMe()
    delete (me as { emailVerified?: boolean }).emailVerified
    expect(deriveResumeStep(me)).toBe("otp")
  })

  it("returns 'name' when verified but no first name yet", () => {
    const me = makeMe({ firstName: null })
    expect(deriveResumeStep(me)).toBe("name")
  })

  it("returns 'pin' when named but no PIN set yet", () => {
    const me = makeMe({ hasPin: false })
    expect(deriveResumeStep(me)).toBe("pin")
  })

  it("returns 'kyc' when PIN is set and the tier is still tier_1", () => {
    const me = makeMe({ hasPin: true, kycTier: "tier_1" })
    expect(deriveResumeStep(me)).toBe("kyc")
  })

  it("returns 'done' when already identity-verified (tier_2)", () => {
    const me = makeMe({ hasPin: true, kycTier: "tier_2" })
    expect(deriveResumeStep(me)).toBe("done")
  })

  it("returns 'done' when already identity-verified (tier_3)", () => {
    const me = makeMe({ hasPin: true, kycTier: "tier_3" })
    expect(deriveResumeStep(me)).toBe("done")
  })
})

describe("useOnboardingMachine", () => {
  it("starts at 'welcome' by default", () => {
    const { result } = renderHook(() => useOnboardingMachine())
    expect(result.current.step).toBe("welcome")
    expect(result.current.data).toEqual({})
  })

  it("accepts an initial step (resume)", () => {
    const { result } = renderHook(() => useOnboardingMachine("pin"))
    expect(result.current.step).toBe("pin")
  })

  it("next() walks the linear order welcome -> email -> otp -> name -> pin -> kyc -> done", () => {
    const { result } = renderHook(() => useOnboardingMachine())

    const expected: string[] = ["email", "otp", "name", "pin", "kyc", "done"]
    for (const step of expected) {
      act(() => result.current.next())
      expect(result.current.step).toBe(step)
    }
  })

  it("next() is a no-op at the terminal 'done' step", () => {
    const { result } = renderHook(() => useOnboardingMachine("done"))
    act(() => result.current.next())
    expect(result.current.step).toBe("done")
  })

  it("back() reverses the linear order", () => {
    const { result } = renderHook(() => useOnboardingMachine("pin"))
    act(() => result.current.back())
    expect(result.current.step).toBe("name")
    act(() => result.current.back())
    expect(result.current.step).toBe("otp")
  })

  it("back() is a no-op at the first 'welcome' step", () => {
    const { result } = renderHook(() => useOnboardingMachine())
    act(() => result.current.back())
    expect(result.current.step).toBe("welcome")
  })

  it("goto('sumsub') jumps out of the linear order from 'kyc'", () => {
    const { result } = renderHook(() => useOnboardingMachine("kyc"))
    act(() => result.current.goto("sumsub"))
    expect(result.current.step).toBe("sumsub")
  })

  it("back() from 'sumsub' returns to 'kyc'", () => {
    const { result } = renderHook(() => useOnboardingMachine("kyc"))
    act(() => result.current.goto("sumsub"))
    act(() => result.current.back())
    expect(result.current.step).toBe("kyc")
  })

  it("next() from 'sumsub' proceeds to 'done'", () => {
    const { result } = renderHook(() => useOnboardingMachine("kyc"))
    act(() => result.current.goto("sumsub"))
    act(() => result.current.next())
    expect(result.current.step).toBe("done")
  })

  it("setData merges partial wizard fields", () => {
    const { result } = renderHook(() => useOnboardingMachine())
    act(() => result.current.setData({ email: "a@b.com" }))
    expect(result.current.data).toEqual({ email: "a@b.com" })
    act(() => result.current.setData({ firstName: "Ada" }))
    expect(result.current.data).toEqual({ email: "a@b.com", firstName: "Ada" })
  })

  it("restart() returns to 'welcome' and clears wizard data", () => {
    const { result } = renderHook(() => useOnboardingMachine("pin"))
    act(() => result.current.setData({ email: "a@b.com" }))
    act(() => result.current.restart())
    expect(result.current.step).toBe("welcome")
    expect(result.current.data).toEqual({})
  })
})
