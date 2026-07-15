import { describe, it, expect } from "vitest"
import { maskPhone } from "./phone"

describe("maskPhone", () => {
  it("masks the middle of a full E.164 NG number, keeping country + area + last 4", () => {
    expect(maskPhone("+2348100000007")).toBe("+234 810 •••• 0007")
  })

  it("preserves a leading + and groups a number without one", () => {
    expect(maskPhone("2348100000007")).toBe("234 810 •••• 0007")
  })

  it("groups an already-spaced number the same way", () => {
    expect(maskPhone("+234 810 000 0007")).toBe("+234 810 •••• 0007")
  })

  it("returns an em-dash for a null / empty phone", () => {
    expect(maskPhone(null)).toBe("—")
    expect(maskPhone(undefined)).toBe("—")
    expect(maskPhone("")).toBe("—")
  })

  it("returns the original for a too-short number (nothing meaningful to mask)", () => {
    expect(maskPhone("12345")).toBe("12345")
  })
})
