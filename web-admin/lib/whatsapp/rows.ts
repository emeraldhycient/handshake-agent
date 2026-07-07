import type { WhatsAppConfigView } from "@handshake-agent/contracts"

import type { WhatsAppHealthRow } from "@/types/components"

/** The mono value's text-token utility for a health-row tone (design per-row `fg`). */
export function toneClass(tone: WhatsAppHealthRow["tone"]): string {
  if (tone === "ok") return "text-tok"
  if (tone === "warn") return "text-twn"
  return "text-ink"
}

/**
 * Derive the real wiring rows from the config view. The non-secret ids/version render
 * as neutral mono wiring; the three secret-presence booleans render only "Set" (`ok`) /
 * "Not set" (`warn`) — never a plaintext secret (§3.5). Blank ids render as a subtle
 * em-dash so the row reads as "not configured" rather than an empty cell.
 */
export function wiringRows(
  config: WhatsAppConfigView
): readonly WhatsAppHealthRow[] {
  const presence = (set: boolean): WhatsAppHealthRow["tone"] =>
    set ? "ok" : "warn"
  const id = (value: string): string => (value.trim() === "" ? "—" : value)
  return [
    { label: "Graph version", value: id(config.graphVersion), tone: "neutral" },
    {
      label: "Phone number ID",
      value: id(config.phoneNumberId),
      tone: "neutral",
    },
    { label: "WABA ID", value: id(config.wabaId), tone: "neutral" },
    { label: "App ID", value: id(config.appId), tone: "neutral" },
    { label: "Flow ID", value: id(config.flowId), tone: "neutral" },
    {
      label: "Beneficiary Flow ID",
      value: id(config.beneficiaryFlowId),
      tone: "neutral",
    },
    {
      label: "App secret",
      value: config.hasAppSecret ? "Set" : "Not set",
      tone: presence(config.hasAppSecret),
    },
    {
      label: "Flow private key",
      value: config.hasFlowPrivateKey ? "Set" : "Not set",
      tone: presence(config.hasFlowPrivateKey),
    },
    {
      label: "Verify token",
      value: config.hasVerifyToken ? "Set" : "Not set",
      tone: presence(config.hasVerifyToken),
    },
  ]
}
