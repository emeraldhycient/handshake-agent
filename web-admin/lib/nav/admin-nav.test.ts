import { describe, expect, it } from "vitest"

import {
  buildVisibleGroups,
  flattenNav,
  isActive,
  itemVisible,
} from "./admin-nav"

describe("itemVisible", () => {
  it("always shows an ungated (null) item", () => {
    expect(itemVisible(null, [])).toBe(true)
  })
  it("shows a single-menu item only when that menu is granted", () => {
    expect(itemVisible("menu.users", ["menu.users"])).toBe(true)
    expect(itemVisible("menu.users", ["menu.audit"])).toBe(false)
  })
  it("shows an array-gated item when ANY listed menu is granted", () => {
    expect(itemVisible(["menu.kyc", "menu.compliance"], ["menu.compliance"])).toBe(true)
    expect(itemVisible(["menu.kyc", "menu.compliance"], ["menu.audit"])).toBe(false)
  })
})

describe("isActive", () => {
  it("matches the root exactly, never by prefix", () => {
    expect(isActive("/", "/")).toBe(true)
    expect(isActive("/users", "/")).toBe(false)
  })
  it("matches non-root routes by prefix (detail pages stay active)", () => {
    expect(isActive("/users/123", "/users")).toBe(true)
    expect(isActive("/ledger", "/users")).toBe(false)
  })
})

describe("buildVisibleGroups", () => {
  it("keeps only menu-permitted items and drops empty groups", () => {
    // Only menu.audit → the Platform group keeps Audit log + System/ops (menu.audit)
    // and the always-on Admin settings, but Overview keeps Dashboard (null gate).
    const groups = buildVisibleGroups(["menu.audit"])
    const platform = groups.find((g) => g.label === "Platform")
    const labels = platform?.items.map((i) => i.label) ?? []
    expect(labels).toContain("Audit log")
    expect(labels).toContain("System / ops")
    expect(labels).toContain("Admin settings")
    expect(labels).not.toContain("Admins & roles") // menu.access, not granted
    // A group with no permitted item is dropped entirely.
    expect(groups.find((g) => g.label === "Customers")).toBeUndefined()
  })

  it("always shows the ungated Dashboard + Admin settings even with no menus", () => {
    const groups = buildVisibleGroups([])
    const all = flattenNav(groups).map((d) => d.label)
    expect(all).toEqual(["Dashboard", "Admin settings"])
  })
})

describe("flattenNav", () => {
  it("flattens groups into href/label/group destinations", () => {
    const dests = flattenNav([
      { label: "G", items: [{ href: "/x", label: "X", icon: (() => null) as never, menu: null }] },
    ])
    expect(dests).toEqual([{ href: "/x", label: "X", group: "G" }])
  })
})
