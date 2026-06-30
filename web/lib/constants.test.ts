/**
 * Tests for the desktop chat greeting helper.
 *
 * BUG FIX: the desktop greeting must never show a hardcoded fake name. It
 * personalizes with the real user's first name when available, and falls back
 * to a NAME-FREE generic greeting otherwise.
 */

import { describe, expect, it } from "vitest"
import { greetingDesktop, GREETING_D, GREETING_M } from "./constants"

describe("greetingDesktop", () => {
  it("personalizes with the user's first name when provided", () => {
    expect(greetingDesktop("Amara")).toContain("Amara")
    expect(greetingDesktop("Amara")).toMatch(/welcome back, amara/i)
  })

  it("trims surrounding whitespace from the first name", () => {
    expect(greetingDesktop("  Amara  ")).toMatch(/welcome back, amara\b/i)
  })

  it("returns a name-free greeting when no name is given", () => {
    const generic = greetingDesktop()
    // No fake placeholder name — the old hardcoded "Amara" must be gone.
    expect(generic).not.toMatch(/amara/i)
    expect(generic).toMatch(/welcome back/i)
  })

  it("returns the name-free greeting for an empty / whitespace-only name", () => {
    expect(greetingDesktop("")).toBe(greetingDesktop())
    expect(greetingDesktop("   ")).toBe(greetingDesktop())
    expect(greetingDesktop(undefined)).toBe(greetingDesktop())
  })
})

describe("greeting constants", () => {
  it("GREETING_D is the name-free generic greeting (no hardcoded name)", () => {
    expect(GREETING_D).toBe(greetingDesktop())
    expect(GREETING_D).not.toMatch(/amara/i)
  })

  it("GREETING_M is name-free", () => {
    expect(GREETING_M).not.toMatch(/amara/i)
  })
})
