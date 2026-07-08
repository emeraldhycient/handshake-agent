import { describe, expect, it } from "vitest"
import type { WhatsAppConfigView } from "@handshake-agent/contracts"

import { toneClass, wiringRows } from "./rows"

const CONFIG: WhatsAppConfigView = {
  graphVersion: "v21.0",
  graphBaseUrl: "https://graph.facebook.com",
  phoneNumberId: "pn-1",
  wabaId: "waba-1",
  appId: "app-1",
  flowId: "flow-1",
  beneficiaryFlowId: "",
  hasAppSecret: true,
  hasFlowPrivateKey: false,
  hasVerifyToken: true,
}

describe("toneClass", () => {
  it("maps tones to text tokens", () => {
    expect(toneClass("ok")).toBe("text-tok")
    expect(toneClass("warn")).toBe("text-twn")
    expect(toneClass("neutral")).toBe("text-ink")
  })
})

describe("wiringRows", () => {
  const rows = wiringRows(CONFIG)
  const byLabel = (label: string) => rows.find((r) => r.label === label)

  it("renders non-secret ids as neutral wiring, em-dashing a blank id", () => {
    expect(byLabel("Graph version")).toEqual({
      label: "Graph version",
      value: "v21.0",
      tone: "neutral",
    })
    expect(byLabel("Beneficiary Flow ID")?.value).toBe("—")
  })
  it("renders secret PRESENCE only — Set (ok) / Not set (warn), never a value", () => {
    expect(byLabel("App secret")).toEqual({
      label: "App secret",
      value: "Set",
      tone: "ok",
    })
    expect(byLabel("Flow private key")).toEqual({
      label: "Flow private key",
      value: "Not set",
      tone: "warn",
    })
  })
})
