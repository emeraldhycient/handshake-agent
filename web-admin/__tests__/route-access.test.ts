/**
 * route-access — the canonical route → permission resolver behind the centralized
 * AdminGuard. Pure functions; no React.
 */
import { describe, expect, it } from "vitest"

import { routeAccessFor, isRouteGranted } from "@/lib/route-access"
import { NAV_GROUPS } from "@/constants/admin-nav"

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

  it("treats the dashboard and admin-settings as auth-only", () => {
    expect(routeAccessFor("/")).toEqual({ menu: null })
    expect(routeAccessFor("/admin-settings")).toEqual({ menu: null })
  })

  it("gates /metrics on menu.metrics (lock-step with the nav item)", () => {
    expect(routeAccessFor("/metrics")).toEqual({ menu: "menu.metrics" })
  })

  it("gates /approvals on menu.approvals so ops/finance/compliance checkers can reach their inbox", () => {
    // The permission catalog grants menu.approvals to every checker role;
    // menu.access stays reserved for /admins, /roles and /sessions.
    expect(routeAccessFor("/approvals")).toEqual({ menu: "menu.approvals" })
  })

  it("maps the restored orphan routes to their menus", () => {
    expect(routeAccessFor("/compliance")).toEqual({
      menu: ["menu.kyc", "menu.compliance"],
    })
    expect(routeAccessFor("/beneficiaries")).toEqual({ menu: "menu.users" })
    expect(routeAccessFor("/roles")).toEqual({ menu: "menu.access" })
    expect(routeAccessFor("/sessions")).toEqual({ menu: "menu.access" })
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

describe("nav ↔ route-access lock-step", () => {
  // "Can see the nav link" and "can open the page" must agree: every sidebar
  // item's menu gate must be exactly the route-access requirement for its href.
  const navItems = NAV_GROUPS.flatMap((group) => group.items)

  it.each(navItems.map((item) => [item.href, item] as const))(
    "%s gates identically in the nav and in route-access",
    (_href, item) => {
      expect(routeAccessFor(item.href).menu).toEqual(item.menu)
    }
  )
})
