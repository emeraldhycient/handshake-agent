import { describe, expect, it } from "vitest"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import { buildRows } from "./build"

function setting(key: string, value: unknown): EffectiveSetting {
  return {
    key,
    label: key,
    description: "",
    category: "Catalog",
    valueType: "boolean",
    editable: true,
    value,
    scope: "global",
    scopeValue: null,
    source: "db",
  }
}

describe("buildRows", () => {
  it("resolves `on` from the live boolean and carries the write key + scope", () => {
    const rows = buildRows([
      setting("catalog.capabilities.crypto.buy", true),
      setting("catalog.capabilities.crypto.sell", false),
    ])
    expect(rows).toHaveLength(2)
    const buy = rows.find((r) => r.settingKey.endsWith(".buy"))
    expect(buy?.on).toBe(true)
    expect(buy?.scope).toBe("global")
    expect(rows.find((r) => r.settingKey.endsWith(".sell"))?.on).toBe(false)
  })

  it("fails closed for a non-boolean value", () => {
    const rows = buildRows([setting("catalog.capabilities.crypto.buy", "true")])
    expect(rows[0].on).toBe(false)
  })

  it("drops rows whose backing key is absent from the registry", () => {
    expect(buildRows([])).toEqual([])
    expect(
      buildRows([setting("catalog.capabilities.crypto.buy", true)])
    ).toHaveLength(1)
  })
})
