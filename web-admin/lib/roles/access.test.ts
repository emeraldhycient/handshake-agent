import { describe, expect, it } from "vitest"
import type { Role } from "@handshake-agent/contracts"

import { accessLevel, CATALOG_BY_CATEGORY, MATRIX_CATEGORIES } from "./access"

function role(permissionIds: string[]): Role {
  return {
    id: "r-1",
    name: "Test",
    description: "",
    isBuiltin: false,
    permissionIds,
  }
}

// A category that has both a :read id and a non-read (write/execute) id — needed to
// exercise the full/read/none branches deterministically.
const category = MATRIX_CATEGORIES.find((c) => {
  const ids = CATALOG_BY_CATEGORY.get(c) ?? []
  return (
    ids.some((id) => id.endsWith(":read")) &&
    ids.some((id) => !id.endsWith(":read"))
  )
})!
const ids = CATALOG_BY_CATEGORY.get(category) ?? []
const readId = ids.find((id) => id.endsWith(":read"))!
const writeId = ids.find((id) => !id.endsWith(":read"))!

describe("accessLevel", () => {
  it("returns 'none' when the role grants nothing in the category", () => {
    expect(accessLevel(role([]), category)).toBe("none")
  })
  it("returns 'read' when the role grants only read actions", () => {
    expect(accessLevel(role([readId]), category)).toBe("read")
  })
  it("returns 'full' when the role grants any non-read action", () => {
    expect(accessLevel(role([readId, writeId]), category)).toBe("full")
  })
})

describe("MATRIX_CATEGORIES", () => {
  it("only lists categories that have at least one catalog entry", () => {
    expect(MATRIX_CATEGORIES.length).toBeGreaterThan(0)
    for (const c of MATRIX_CATEGORIES) {
      expect((CATALOG_BY_CATEGORY.get(c) ?? []).length).toBeGreaterThan(0)
    }
  })
})
