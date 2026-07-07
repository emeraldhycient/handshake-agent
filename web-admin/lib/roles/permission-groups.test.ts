import { describe, expect, it } from "vitest"
import { PERMISSION_CATALOG, permissionId } from "@handshake-agent/contracts"

import { PERMISSION_GROUPS } from "./permission-groups"

describe("PERMISSION_GROUPS", () => {
  it("groups every catalog entry under exactly one category (no loss, no dupes)", () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.entries)
    expect(grouped).toHaveLength(PERMISSION_CATALOG.length)
    const ids = new Set(grouped.map(permissionId))
    expect(ids.size).toBe(PERMISSION_CATALOG.length)
  })
  it("has distinct, non-empty categories", () => {
    const cats = PERMISSION_GROUPS.map((g) => g.category)
    expect(new Set(cats).size).toBe(cats.length)
    for (const g of PERMISSION_GROUPS) {
      expect(g.category).not.toBe("")
      expect(g.entries.length).toBeGreaterThan(0)
      expect(g.entries.every((e) => e.category === g.category)).toBe(true)
    }
  })
})
