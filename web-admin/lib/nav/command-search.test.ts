import { describe, expect, it } from "vitest"
import type { NavDestination } from "@/types"

import { buildResults, matches } from "./command-search"

const DESTS: NavDestination[] = [
  { href: "/users", label: "Users", group: "Customers" },
  { href: "/ledger", label: "Ledger", group: "Money" },
  { href: "/treasury", label: "Treasury", group: "Money" },
]

describe("matches", () => {
  it("matches an empty query to everything", () => {
    expect(matches(DESTS[0], "  ")).toBe(true)
  })
  it("matches on the label or the group (case-insensitive)", () => {
    expect(matches(DESTS[0], "USER")).toBe(true)
    expect(matches(DESTS[1], "money")).toBe(true)
    expect(matches(DESTS[0], "money")).toBe(false)
  })
})

describe("buildResults", () => {
  it("puts entity hits first, then the matching nav pages", () => {
    const entities = [{ href: "/users/u-1", label: "Ada", sublabel: "user" }]
    const results = buildResults(entities, DESTS, "money")
    expect(results.map((r) => r.href)).toEqual([
      "/users/u-1",
      "/ledger",
      "/treasury",
    ])
    // Backend result maps sublabel → the NavDestination group subtitle.
    expect(results[0]).toEqual({
      href: "/users/u-1",
      label: "Ada",
      group: "user",
    })
  })
  it("returns all destinations (after entities) for an empty query", () => {
    expect(buildResults([], DESTS, "")).toHaveLength(3)
  })
})
