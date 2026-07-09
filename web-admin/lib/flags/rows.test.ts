import { describe, expect, it } from "vitest"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import { resolveFlags, toggleDiff } from "./rows"

function setting(key: string, value: unknown): EffectiveSetting {
  return {
    key,
    label: key,
    description: "",
    category: "KYC",
    valueType: "boolean",
    editable: true,
    value,
    scope: "global",
    scopeValue: null,
    source: "db",
  }
}

describe("resolveFlags", () => {
  it("resolves a registry-backed flag from its backing setting (fail-closed)", () => {
    const rows = resolveFlags([
      setting("catalog.capabilities.crypto.swap", false),
    ])
    const swap = rows.find((r) => r.key === "swap.enabled")
    // backed → takes the real value (false), overriding the design default (true)
    expect(swap?.on).toBe(false)
    expect(swap?.settingKey).toBe("catalog.capabilities.crypto.swap")
  })
  it("renders an unbacked flag with no backing key and no fabricated on-state", () => {
    const rows = resolveFlags([])
    const voice = rows.find((r) => r.key === "voice_notes.web")
    // Unbacked flags are read-only "Not yet wired" rows — never claimed enabled.
    expect(voice?.on).toBe(false)
    expect(voice?.settingKey).toBeUndefined()
    expect(voice?.rollout).toBeUndefined()
  })
  it("fail-closes a backed flag whose setting is absent/non-boolean to its default", () => {
    const rows = resolveFlags([])
    const ticketing = rows.find((r) => r.key === "ticketing.enabled")
    expect(ticketing?.on).toBe(false) // design default when the key is absent
  })
})

describe("toggleDiff", () => {
  it("renders on→off for an enabled flag", () => {
    const [flag] = resolveFlags([
      setting("catalog.capabilities.crypto.swap", true),
    ]).filter((r) => r.key === "swap.enabled")
    expect(toggleDiff(flag)).toEqual([
      { field: "swap.enabled · enabled", from: "on", to: "off" },
    ])
  })
  it("returns [] for no pending flag", () => {
    expect(toggleDiff(null)).toEqual([])
  })
})
