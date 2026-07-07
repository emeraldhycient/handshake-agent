import { describe, expect, it } from "vitest"

import { formatLastLogin, roleDot } from "./format"
import { ROLE_DOT_PALETTE } from "@/constants/admins"

describe("roleDot", () => {
  it("returns a palette colour deterministically for a role name", () => {
    const a = roleDot("Super Admin")
    expect(ROLE_DOT_PALETTE).toContain(a)
    expect(roleDot("Super Admin")).toBe(a) // stable across calls
  })
  it("maps different names into the palette by hash", () => {
    expect(ROLE_DOT_PALETTE).toContain(roleDot("Compliance"))
    expect(ROLE_DOT_PALETTE).toContain(roleDot(""))
  })
})

describe("formatLastLogin", () => {
  it("returns 'Never' for null / unparseable input", () => {
    expect(formatLastLogin(null)).toBe("Never")
    expect(formatLastLogin("not-a-date")).toBe("Never")
  })
  it("formats a valid ISO stamp as 'Mon D, YYYY · HH:MM'", () => {
    const iso = "2026-07-03T16:23:00.000Z"
    const d = new Date(iso)
    const expected = `${d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })} · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    expect(formatLastLogin(iso)).toBe(expected)
  })
})
