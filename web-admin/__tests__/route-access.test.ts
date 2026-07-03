/**
 * route-access — the canonical route → permission resolver behind the centralized
 * AdminGuard. Pure functions; no React.
 */
import { describe, expect, it } from "vitest"

import { routeAccessFor, isRouteGranted } from "@/lib/route-access"

describe("routeAccessFor", () => {
  it("maps a static route to its menu requirement", () => {
    expect(routeAccessFor("/admins")).toEqual({ menu: "menu.access" })
    expect(routeAccessFor("/transactions")).toEqual({
      menu: "menu.transactions",
    })
  })

  it("maps compliance routes to the kyc|compliance menu pair", () => {
    expect(routeAccessFor("/aml")).toEqual({
      menu: ["menu.kyc", "menu.compliance"],
    })
  })

  it("treats the dashboard, metrics, and admin-settings as auth-only", () => {
    expect(routeAccessFor("/")).toEqual({ menu: null })
    expect(routeAccessFor("/metrics")).toEqual({ menu: null })
    expect(routeAccessFor("/admin-settings")).toEqual({ menu: null })
  })

  it("resolves dynamic detail routes by prefix", () => {
    expect(routeAccessFor("/users/abc-123")).toEqual({ menu: "menu.users" })
    expect(routeAccessFor("/transactions/tx_9")).toEqual({
      menu: "menu.transactions",
    })
  })

  it("defaults an unknown route to authenticated-only (never hard-blocks)", () => {
    expect(routeAccessFor("/some/new/screen")).toEqual({ menu: null })
  })
})

describe("isRouteGranted", () => {
  it("grants super_admin everything, regardless of menus", () => {
    expect(
      isRouteGranted({ menu: "menu.access" }, "super_admin", [])
    ).toBe(true)
  })

  it("grants any authenticated admin an auth-only route", () => {
    expect(isRouteGranted({ menu: null }, "support", [])).toBe(true)
  })

  it("grants when the operator holds one of the required menus", () => {
    expect(
      isRouteGranted({ menu: ["menu.kyc", "menu.compliance"] }, "ops", [
        "menu.compliance",
      ])
    ).toBe(true)
  })

  it("denies when the operator holds none of the required menus", () => {
    expect(
      isRouteGranted({ menu: "menu.access" }, "ops", [
        "menu.transactions",
        "menu.audit",
      ])
    ).toBe(false)
  })
})
