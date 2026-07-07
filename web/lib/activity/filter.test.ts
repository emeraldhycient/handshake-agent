import { describe, expect, it } from "vitest"
import { matchesFilter } from "./filter"
import type { ActivityItem } from "@/lib/schemas"

const item = (dir: ActivityItem["dir"]) => ({ dir }) as ActivityItem

describe("matchesFilter", () => {
  it("matches everything for 'all'", () => {
    expect(matchesFilter(item("in"), "all")).toBe(true)
    expect(matchesFilter(item("out"), "all")).toBe(true)
  })
  it("maps received→in, sent→out, tickets→ticket", () => {
    expect(matchesFilter(item("in"), "received")).toBe(true)
    expect(matchesFilter(item("out"), "received")).toBe(false)
    expect(matchesFilter(item("out"), "sent")).toBe(true)
    expect(matchesFilter(item("ticket"), "tickets")).toBe(true)
    expect(matchesFilter(item("in"), "tickets")).toBe(false)
  })
})
